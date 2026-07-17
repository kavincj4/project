//-- copyright
// OpenProject is an open source project management software.
// Copyright (C) the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See COPYRIGHT and LICENSE files for more details.
//++

import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { preventUnhandled } from '@atlaskit/pragmatic-drag-and-drop/prevent-unhandled';
import { registerAutoScroll, type AutoScrollAllowedAxis } from 'core-common/drag-and-drop/auto-scroll';
import { clearDropIndicator, renderDropIndicator } from 'core-common/drag-and-drop/drop-indicator';
import { createSortableItemPayloadScope, type SortableItemData } from 'core-common/drag-and-drop/payload';
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
  type SortableAxis,
} from 'core-common/drag-and-drop/reorder';
import { closestInteractiveElement } from 'core-common/interactive-element-helper';

export type CleanupFn = () => void;

export interface SortableSource {
  itemId:string;
  listId:string;
  element:HTMLElement;
}

export interface SortableDropIntent {
  sourceId:string;
  sourceListId:string;
  targetListId:string;
  targetItemId:string|null;   // null = container drop → append
  edge:Edge|null;
}

export interface SortableDropTransaction {
  id:string;
  intent:SortableDropIntent;
  complete(success:boolean):void;   // idempotent; resolves after onDrop returns
  completion:Promise<boolean>;
  finalize():void;                  // idempotent; source-side settlement
}

export type PreviewFactory = (args:{
  source:SortableSource;
  container:HTMLElement;
}) => CleanupFn|void;

export interface SortableRootOptions {
  element:HTMLElement;
  axis?:SortableAxis;               // default 'vertical'
  preview?:'native'|PreviewFactory; // default 'native'
  onDragStarted?:(source:SortableSource) => void;
  onCancel?:(source:SortableSource) => void;
  onDrop:(transaction:SortableDropTransaction) => void;
}

export interface SortableRoot {
  registerList(opts:{
    element:HTMLElement;
    listId:string;
    accepts?:(args:{ source:SortableSource }) => boolean;
    scrollContainer?:Element;
  }):CleanupFn;
  registerItem(opts:{
    element:HTMLElement;
    itemId:string;
    listId:string;
    canDrag?:(args:{ element:HTMLElement; pointer:{ clientX:number; clientY:number } }) => boolean;
  }):CleanupFn;
  addScrollContainer(element:Element, axis?:AutoScrollAllowedAxis):CleanupFn;
  destroy():void;
}

function allowedEdgesForAxis(axis:SortableAxis):Edge[] {
  return axis === 'horizontal' ? ['left', 'right'] : ['top', 'bottom'];
}

export function createSortableRoot(options:SortableRootOptions):SortableRoot {
  const axis = options.axis ?? 'vertical';
  const allowedEdges = allowedEdgesForAxis(axis);
  const scope = createSortableItemPayloadScope();
  const listDataKey = Symbol('op-sortable-list');
  const lists = new Map<string, { element:HTMLElement; accepts?:(args:{ source:SortableSource }) => boolean }>();
  // Registered item elements per list, in registration order, so bounded
  // stickiness (below) can read the leading/trailing edge of the items span
  // without querying the DOM on every pointer move.
  const listItems = new Map<string, Set<HTMLElement>>();
  let transactionCounter = 0;
  let destroyed = false;
  const cleanups:CleanupFn[] = [];

  // Registers `fn` for `destroy()` and returns an idempotent handle that also
  // deregisters itself, so a caller-invoked cleanup never double-runs when
  // `destroy()` later sweeps the same list.
  const track = (fn:CleanupFn):CleanupFn => {
    let done = false;
    const wrapped = ():void => {
      if (done) {
        return;
      }
      done = true;
      const index = cleanups.indexOf(wrapped);
      if (index !== -1) {
        cleanups.splice(index, 1);
      }
      fn();
    };
    cleanups.push(wrapped);
    return wrapped;
  };

  const isListData = (data:Record<string|symbol, unknown>):data is { listId:string } =>
    data[listDataKey] === true && typeof data.listId === 'string';

  const sourceOf = (data:SortableItemData, element:Element):SortableSource => ({
    itemId: data.itemId, listId: data.listId, element: element as HTMLElement,
  });

  // Busy = a transaction is in flight and not yet fully settled. While busy,
  // no further drag can start or resolve, so a second drop can never race the
  // consumer's own reaction to the first (spec §A: one drop at a time).
  const isBusy = ():boolean => options.element.hasAttribute('data-sortable-lists-busy');
  const setBusy = (busy:boolean):void => {
    if (busy) {
      options.element.setAttribute('data-sortable-lists-busy', 'true');
    } else {
      options.element.removeAttribute('data-sortable-lists-busy');
    }
  };

  // Foreign-source gate shared by a list's own drop target and every one of
  // its items: a list can never reject its own items, so same-list drags are
  // always admitted — `accepts` only screens drags arriving from elsewhere.
  const admits = (
    listId:string,
    accepts:((args:{ source:SortableSource }) => boolean)|undefined,
    data:SortableItemData,
    element:Element,
  ):boolean => data.listId === listId || !accepts || accepts({ source: sourceOf(data, element) });

  // Bounded stickiness (spec §item→list handoff): an item drop target holds
  // onto selection — via Pragmatic's `getIsSticky` — while the pointer is
  // still within the CURRENT visual span of its list's items along the root
  // axis, even when the pointer's current native target is the list element
  // itself (e.g. a gap between rows). Beyond that span the item releases and
  // the list's own container target takes over.
  //
  // The span is the geometric min/max over every registered item's CURRENT
  // rect — not the first/last item by registration order. A `@for` with a
  // stable `track` reorders DOM nodes without re-running the item
  // directive's `ngOnInit` (so `registerItem` never re-runs), which would
  // leave an order-based span stale relative to the new visual layout after
  // such a reorder. Recomputing geometrically on every call costs the same
  // O(n) shape as before (still one rect read per item) and stays correct
  // regardless of registration order.
  const withinItemsSpan = (input:{ clientX:number; clientY:number }, listId:string):boolean => {
    const items = listItems.get(listId);
    if (!items || items.size === 0) {
      return false;
    }

    let leadingEdge = Infinity;
    let trailingEdge = -Infinity;
    items.forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (axis === 'horizontal') {
        leadingEdge = Math.min(leadingEdge, rect.left);
        trailingEdge = Math.max(trailingEdge, rect.right);
      } else {
        leadingEdge = Math.min(leadingEdge, rect.top);
        trailingEdge = Math.max(trailingEdge, rect.bottom);
      }
    });

    return axis === 'horizontal'
      ? input.clientX >= leadingEdge && input.clientX <= trailingEdge
      : input.clientY >= leadingEdge && input.clientY <= trailingEdge;
  };

  const createTransaction = (intent:SortableDropIntent):SortableDropTransaction => {
    transactionCounter += 1;
    const id = `op-sortable-txn-${transactionCounter}`;
    // Same-list moves have no cross-list source to settle separately, so
    // completing the target side is the only settlement they need — a
    // caller that never calls `finalize()` for a same-list move must not
    // leave the root stuck busy forever.
    const sameList = intent.sourceListId === intent.targetListId;
    let completed = false;
    let finalized = false;
    let resolveCompletion!:(success:boolean) => void;
    const completion = new Promise<boolean>((resolve) => {
      resolveCompletion = resolve;
    });

    setBusy(true);
    const diagnostic = window.setTimeout(() => {
      console.warn(`Sortable transaction ${id} neither completed nor finalized after 10s.`);
    }, 10_000);
    // Tracked like every other registration, so `destroy()` cancels any
    // diagnostic still pending for a transaction that never settles (e.g.
    // the consumer navigates away mid-drop) instead of leaking a timer that
    // outlives the root and warns after teardown.
    const clearDiagnostic = track(() => window.clearTimeout(diagnostic));

    const trySettle = ():void => {
      if (completed && (finalized || sameList)) {
        clearDiagnostic();
        setBusy(false);
      }
    };

    return {
      id,
      intent,
      completion,
      complete(success:boolean):void {
        if (completed) {
          return;
        }
        completed = true;
        // Deferred so a synchronous `complete()` call inside the consumer's
        // `onDrop` cannot outrun that same callback's own emissions.
        queueMicrotask(() => {
          resolveCompletion(success);
          trySettle();
        });
      },
      finalize():void {
        if (finalized) {
          return;
        }
        finalized = true;
        queueMicrotask(trySettle);
      },
    };
  };

  // Root monitor: THE single drop-resolution point (spec §A). Routed through
  // `track()` like every other registration, so `destroy()` stays uniform and
  // a second `destroy()` call never re-invokes it.
  track(monitorForElements({
    canMonitor: ({ source }) => !isBusy() && scope.isItemData(source.data),
    onDrop: ({ source, location }) => {
      preventUnhandled.stop();
      delete source.element.dataset.dragging;

      const data = source.data as SortableItemData;
      const src = sourceOf(data, source.element);
      const targets = location.current.dropTargets;
      const itemTarget = targets.find((t) => scope.isItemData(t.data));
      const listTarget = targets.find((t) => isListData(t.data));

      if (!itemTarget && !listTarget) {
        options.onCancel?.(src);          // outside every registered list
        return;
      }

      const targetItemData = itemTarget?.data as SortableItemData|undefined;
      if (targetItemData?.itemId === data.itemId
          && targetItemData?.listId === data.listId) {
        return;                           // self-drop: no intent
      }

      const intent:SortableDropIntent = {
        sourceId: data.itemId,
        sourceListId: data.listId,
        targetListId: targetItemData?.listId
          ?? (listTarget!.data as unknown as { listId:string }).listId,
        targetItemId: targetItemData?.itemId ?? null,
        edge: itemTarget ? extractClosestEdge(itemTarget.data) : null,
      };
      options.onDrop(createTransaction(intent));
    },
  }));

  return {
    registerList({
      element, listId, accepts, scrollContainer,
    }):CleanupFn {
      lists.set(listId, { element, accepts });

      const clearContainerIndicator = ():void => {
        delete element.dataset.dropContainer;
      };

      const syncContainerIndicator = ({ location }:{ location:{ current:{ dropTargets:{ element:Element }[] } } }):void => {
        if (location.current.dropTargets[0]?.element === element) {
          element.dataset.dropContainer = 'active';
        } else {
          clearContainerIndicator();
        }
      };

      const dropTargetCleanup = dropTargetForElements({
        element,
        getData: () => ({ [listDataKey]: true, listId }),
        canDrop: ({ source }) => !isBusy()
          && scope.isItemData(source.data)
          && admits(listId, accepts, source.data, source.element),
        getIsSticky: () => false,
        onDragEnter: syncContainerIndicator,
        onDrag: syncContainerIndicator,
        onDragLeave: clearContainerIndicator,
        onDrop: clearContainerIndicator,
      });

      const autoScrollCleanup = registerAutoScroll({
        element: scrollContainer ?? element,
        canScroll: ({ source }) => scope.isItemData(source.data),
        axis,
      });

      return track(combine(dropTargetCleanup, autoScrollCleanup, () => {
        lists.delete(listId);
        clearContainerIndicator();
      }));
    },

    registerItem({
      element, itemId, listId, canDrag,
    }):CleanupFn {
      const clearIndicator = ():void => clearDropIndicator(element, itemId);

      // The item accepts itself as a drop target (see the canDrop comment
      // below), but the indicator must never draw a drop-position line on
      // the row that is itself being dragged. Suppression belongs here, not
      // in canDrop: canDrop gates whether a drop is possible, and the root
      // monitor still needs self as a resolvable item target to distinguish
      // "self-drop, no intent" from "no item target, fall through to
      // container append".
      const isSelfSource = (data:Record<string|symbol, unknown>):boolean =>
        scope.isItemData(data) && data.itemId === itemId && data.listId === listId;

      const itemsForList = listItems.get(listId) ?? new Set<HTMLElement>();
      itemsForList.add(element);
      listItems.set(listId, itemsForList);

      const draggableCleanup = draggable({
        element,
        // Interactive-descendant suppression composes before the consumer's
        // own `canDrag`: a pointer over a button/input/link/etc. inside the
        // row must never start a drag, regardless of what the consumer
        // decides — that descendant needs its native click/focus behavior.
        canDrag: ({ input }) => {
          if (isBusy()) {
            return false;
          }
          const target = element.ownerDocument.elementFromPoint(input.clientX, input.clientY);
          if (target instanceof Element && element.contains(target)
              && closestInteractiveElement(target, element) !== null) {
            return false;
          }
          return canDrag ? canDrag({ element, pointer: { clientX: input.clientX, clientY: input.clientY } }) : true;
        },
        getInitialData: () => scope.itemData(itemId, listId),
        onDragStart: () => {
          preventUnhandled.start();
          element.dataset.dragging = 'source';
          options.onDragStarted?.({ itemId, listId, element });
        },
        // Only wired when the consumer supplies a factory; 'native' (or the
        // unset default) leaves Pragmatic's own browser-native preview alone.
        ...(typeof options.preview === 'function' ? {
          onGenerateDragPreview: ({ nativeSetDragImage, source }:{
            nativeSetDragImage:DataTransfer['setDragImage']|null;
            source:{ element:Element; data:Record<string|symbol, unknown> };
          }) => {
            const factory = options.preview as PreviewFactory;
            setCustomNativeDragPreview({
              nativeSetDragImage,
              render: ({ container }) => factory({
                source: sourceOf(source.data as SortableItemData, source.element),
                container,
              }) ?? undefined,
            });
          },
        } : {}),
      });

      // No same-item exclusion here: letting the dragged item register as its
      // own drop target is what lets the root monitor's self-drop check (not
      // this canDrop) see it as the resolved item target and no-op, instead
      // of falling through to the enclosing list's container-append target.
      const dropTargetCleanup = dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          if (isBusy() || !scope.isItemData(source.data)) {
            return false;
          }
          const list = lists.get(listId);
          return admits(listId, list?.accepts, source.data, source.element);
        },
        getData: ({ input }) => attachClosestEdge(scope.itemData(itemId, listId), {
          element,
          input,
          allowedEdges,
        }),
        // Bounded stickiness: keeps this item the resolved target while the
        // pointer stays within the list's items span (see `withinItemsSpan`),
        // even if the pointer's live native target has moved to the list
        // element itself. Releases beyond the span so the list's container
        // target can take over (item→list handoff).
        getIsSticky: ({ input }) => withinItemsSpan({ clientX: input.clientX, clientY: input.clientY }, listId),
        onDragEnter: ({ source, self }) => (
          isSelfSource(source.data) ? clearIndicator() : renderDropIndicator(element, extractClosestEdge(self.data), itemId)
        ),
        onDrag: ({ source, self }) => (
          isSelfSource(source.data) ? clearIndicator() : renderDropIndicator(element, extractClosestEdge(self.data), itemId)
        ),
        onDragLeave: clearIndicator,
        onDrop: clearIndicator,
      });

      return track(combine(draggableCleanup, dropTargetCleanup, () => {
        delete element.dataset.dragging;
        clearIndicator();
        itemsForList.delete(element);
      }));
    },

    addScrollContainer(element:Element, scrollAxis:AutoScrollAllowedAxis = 'all'):CleanupFn {
      return track(registerAutoScroll({
        element,
        canScroll: ({ source }) => scope.isItemData(source.data),
        axis: scrollAxis,
      }));
    },

    destroy():void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      [...cleanups].forEach((fn) => fn());
      lists.clear();
    },
  };
}
