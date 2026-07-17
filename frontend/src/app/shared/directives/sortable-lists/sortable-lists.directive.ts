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
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import {
  createSortableRoot,
  type SortableDropTransaction,
  type SortableRoot,
} from 'core-common/drag-and-drop/sortable-lists-engine';
import { type Edge } from 'core-common/drag-and-drop/reorder';
// Type-only: `OpSortableListsListDirective` injects this directive at
// runtime, so importing it here as a value would create a live circular
// module dependency. The type is all this file needs.
import type { OpSortableListsListDirective } from './sortable-lists-list.directive';

export type SortableListsAxis = 'vertical'|'horizontal';

export interface SortableListsDropEvent {
  transactionId:string;
  sourceId:string;
  sourceListId:string;
  targetId:string|null;
  edge:Edge|null;
  complete(success:boolean):void;
}

export interface SortableListsRemovedEvent {
  transactionId:string;
  itemId:string;
  targetListId:string;
  completion:Promise<boolean>;
  finalize():void;
}

type CleanupFn = () => void;

let lastGeneratedId = 0;

function generateListId():string {
  lastGeneratedId += 1;
  return `op-sortable-list-${lastGeneratedId}`;
}

// The root of one drag-and-drop scope, thinly binding the shared sortable
// engine to Angular's view lifecycle. Mirrors the Stimulus `sortable-lists`
// root controller: it owns nothing about the consumer's data, only relays
// resolved drop intents.
//
// A root with no explicit `opSortableListsList` child behaves as a single
// implicit list (the common case, e.g. the draggable autocompleter): items
// register directly against the root, and the root's own
// `opSortableListsDrop`/`opSortableListsRemoved` outputs fire. Once an
// explicit list registers, the implicit list steps aside and drops route to
// the owning list's own outputs instead — see `attachList`.
@Directive({
  selector: '[opSortableLists]',
})
export class OpSortableListsDirective implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly destroyRef = inject(DestroyRef);

  axis = input<SortableListsAxis>('vertical', { alias: 'opSortableListsAxis' });

  // Proxy outputs: statically declared so a template can always bind them,
  // but only emit while this root is acting as the implicit (collapsed)
  // list — see the class doc comment.
  opSortableListsDrop = output<SortableListsDropEvent>();

  opSortableListsRemoved = output<SortableListsRemovedEvent>();

  readonly implicitListId = generateListId();

  private readonly childLists = new Map<string, OpSortableListsListDirective>();

  private engineRoot:SortableRoot|null = null;

  private implicitListCleanup:CleanupFn|null = null;

  ngAfterViewInit():void {
    // Guarantees the engine (and, absent any explicit list, the implicit
    // list) exists even when the root never receives an item — an empty
    // list must still be a valid drop target for items dragged in from
    // elsewhere. `getEngineRoot` is idempotent: an item or list directive
    // nested inside this root may have already triggered it from its own
    // (earlier-running) `ngOnInit`.
    this.getEngineRoot();
  }

  // Called by an explicit `opSortableListsList` child from its `ngOnInit`.
  // The first explicit list to attach retires the implicit list; the last
  // one to detach brings it back.
  attachList(list:OpSortableListsListDirective):CleanupFn {
    const engineRoot = this.getEngineRoot();

    if (this.childLists.size === 0) {
      this.unregisterImplicitList();
    }

    const listId = list.listId();
    this.childLists.set(listId, list);

    const cleanup = engineRoot.registerList({
      element: list.elementRef.nativeElement,
      listId,
      accepts: this.wrapAccepts(list.accepts()),
      scrollContainer: list.scrollContainer() ?? undefined,
    });

    return () => {
      cleanup();
      this.childLists.delete(listId);
      if (this.childLists.size === 0) {
        this.registerImplicitList();
      }
    };
  }

  // Internal API used by `OpSortableListsItemDirective`. Adapts the
  // consumer-facing no-argument `canDrag` to the engine's pointer-context
  // signature.
  registerItem(opts:{
    element:HTMLElement;
    itemId:string;
    listId:string;
    canDrag?:() => boolean;
  }):CleanupFn {
    const engineRoot = this.getEngineRoot();

    return engineRoot.registerItem({
      element: opts.element,
      itemId: opts.itemId,
      listId: opts.listId,
      canDrag: opts.canDrag ? () => opts.canDrag!() : undefined,
    });
  }

  private getEngineRoot():SortableRoot {
    if (!this.engineRoot) {
      this.engineRoot = createSortableRoot({
        element: this.elementRef.nativeElement,
        axis: this.axis(),
        onDrop: (transaction) => this.dispatch(transaction),
      });
      this.destroyRef.onDestroy(() => this.engineRoot?.destroy());
      this.registerImplicitList();
    }

    return this.engineRoot;
  }

  private registerImplicitList():void {
    if (this.implicitListCleanup || !this.engineRoot) {
      return;
    }

    this.implicitListCleanup = this.engineRoot.registerList({
      element: this.elementRef.nativeElement,
      listId: this.implicitListId,
    });
  }

  private unregisterImplicitList():void {
    this.implicitListCleanup?.();
    this.implicitListCleanup = null;
  }

  private wrapAccepts(accepts:(() => boolean)|null):(() => boolean)|undefined {
    return accepts ? () => accepts() : undefined;
  }

  // Cross-list moves emit `removed` on the source list BEFORE `drop` on the
  // target list, so a consumer reacting to `removed` never sees the item
  // still present in the target's rendered list. Same-list moves emit
  // `drop` only — there is nothing to remove.
  private dispatch(transaction:SortableDropTransaction):void {
    const { intent } = transaction;

    const drop:SortableListsDropEvent = {
      transactionId: transaction.id,
      sourceId: intent.sourceId,
      sourceListId: intent.sourceListId,
      targetId: intent.targetItemId,
      edge: intent.edge,
      complete: (success) => transaction.complete(success),
    };

    if (intent.sourceListId !== intent.targetListId) {
      const removed:SortableListsRemovedEvent = {
        transactionId: transaction.id,
        itemId: intent.sourceId,
        targetListId: intent.targetListId,
        completion: transaction.completion,
        finalize: () => transaction.finalize(),
      };
      this.emitRemoved(intent.sourceListId, removed);
    }

    this.emitDrop(intent.targetListId, drop);
  }

  private emitDrop(listId:string, event:SortableListsDropEvent):void {
    const list = this.childLists.get(listId);
    if (list) {
      list.opSortableListsDrop.emit(event);
    } else {
      this.opSortableListsDrop.emit(event);
    }
  }

  private emitRemoved(listId:string, event:SortableListsRemovedEvent):void {
    const list = this.childLists.get(listId);
    if (list) {
      list.opSortableListsRemoved.emit(event);
    } else {
      this.opSortableListsRemoved.emit(event);
    }
  }
}
