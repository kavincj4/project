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

import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  NativeDragSimulation,
  towardsEdgeOf,
} from 'core-common/drag-and-drop/testing/native-drag-simulation';
import { OpSortableListsItemDirective } from './sortable-lists-item.directive';
import { OpSortableListsListDirective } from './sortable-lists-list.directive';
import {
  OpSortableListsDirective,
  type SortableListsDropEvent,
  type SortableListsRemovedEvent,
} from './sortable-lists.directive';

// Behavioral suite for the directive group: scope resolution (collapsed vs.
// explicit lists, nested roots), the cross-list removed/drop ordering
// contract, and the completion/finalize → busy lifecycle. The Task 8 smoke
// port in `sortable-lists.directive.spec.ts` covers single-root mechanics
// (attribute state, foreign-list rejection, sticky release, item lifecycle);
// this file covers everything that depends on more than one root or list.

describe('sortable-lists directive group behavior', () => {
  describe('single-list collapse (implicit list)', () => {
    @Component({
      imports: [OpSortableListsDirective, OpSortableListsItemDirective],
      template: `
        <div
          class="root"
          opSortableLists
          (opSortableListsDrop)="drops.push($event)"
          style="padding-bottom: 40px;"
        >
          @for (entry of items(); track entry.id) {
            <div
              class="item"
              [opSortableListsItem]="entry.id"
              [opSortableListsItemCanDrag]="entry.canDrag"
              style="height: 40px; width: 200px;"
            >{{ entry.id }}</div>
          }
        </div>
      `,
    })
    class CollapseHostComponent {
      items = signal([
        { id: 'a', canDrag: true },
        { id: 'b', canDrag: true },
        { id: 'c', canDrag: true },
      ]);

      drops:SortableListsDropEvent[] = [];
    }

    let fixture:ComponentFixture<CollapseHostComponent>;
    let host:CollapseHostComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [CollapseHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(CollapseHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    function root():HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelector('.root')!;
    }

    function item(index:number):HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.item')[index];
    }

    it('emits one drop event on the root proxy output and releases busy on complete', async () => {
      const simulation = new NativeDragSimulation(item(0));

      await simulation.start();
      await simulation.drop(item(2), towardsEdgeOf(item(2), 'bottom'));

      expect(host.drops).toHaveLength(1);
      expect(host.drops[0]).toMatchObject({ sourceId: 'a', targetId: 'c', edge: 'bottom' });
      expect(root().hasAttribute('data-sortable-lists-busy')).toBe(true);

      host.drops[0].complete(true);
      // `complete()` defers its own resolution by one microtask hop (see
      // the engine's `createTransaction`); one `await` past the call is
      // enough for that queued job — and the busy release inside it — to
      // have already run before this test resumes.
      await Promise.resolve();

      expect(root().hasAttribute('data-sortable-lists-busy')).toBe(false);
    });

    it('blocks drag start when opSortableListsItemCanDrag is false', async () => {
      host.items.set([
        { id: 'a', canDrag: false },
        { id: 'b', canDrag: true },
      ]);
      fixture.detectChanges();

      const simulation = new NativeDragSimulation(item(0));
      await simulation.start();

      expect(item(0).hasAttribute('data-dragging')).toBe(false);

      // The unblocked sibling still drags normally — proves the gate is
      // per-item, not a root-wide side effect.
      const allowed = new NativeDragSimulation(item(1));
      await allowed.start();
      expect(item(1).dataset.dragging).toBe('source');
      await allowed.cancel();
    });

    // `@for` tracks by id, so replacing the items signal with the SAME ids
    // in a new order moves the existing DOM nodes (and keeps the same
    // `OpSortableListsItemDirective` instances) instead of destroying and
    // recreating them — `ngOnInit`, and so `registerItem`, never re-runs.
    // The engine's bounded-stickiness span (`withinItemsSpan` in
    // `sortable-lists-engine.ts`) is computed geometrically — the min/max
    // of every registered item's CURRENT rect — specifically so it stays
    // correct after a reorder like this, rather than trusting a stale
    // registration order.
    it('keeps items draggable and the append span accurate after a track-by-id reorder', async () => {
      // Registration order was a, b, c (matches initial visual top-to-bottom
      // order). Reorder to visual order c, a, b — same ids, no destroy.
      host.items.set([
        { id: 'c', canDrag: true },
        { id: 'a', canDrag: true },
        { id: 'b', canDrag: true },
      ]);
      fixture.detectChanges();

      const itemLabels = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.item')]
        .map((el) => el.textContent);
      expect(itemLabels).toEqual(['c', 'a', 'b']);

      // Ordinary reorder still works post-churn: dragging the visually
      // bottom item ('b') onto the visually top item ('c') resolves via the
      // real hovered element, independent of registration order.
      const reorder = new NativeDragSimulation(item(2));
      await reorder.start();
      await reorder.drop(item(0), towardsEdgeOf(item(0), 'top'));

      expect(host.drops.map(({ sourceId, targetId, edge }) => ({ sourceId, targetId, edge })))
        .toEqual([{ sourceId: 'b', targetId: 'c', edge: 'top' }]);
      // Same-list transactions settle on `complete()` alone (no `finalize`
      // needed) — release busy before starting the next drag, or every
      // later `canDrag`/`canDrop` check in this test short-circuits false.
      host.drops[0].complete(true);
      await Promise.resolve();
      host.drops = [];

      // Drag the visually bottom item ('b') and dwell over the visually
      // middle item ('a') to make it the sticky resolved target, then
      // simulate the pointer's native target becoming the *root* (as a real
      // dragover over the container reports) while the coordinate is still
      // squarely inside 'a' — comfortably mid-list, not near any edge or
      // the trailing container gap.
      const span = new NativeDragSimulation(item(2));
      await span.start();

      const middleItem = item(1); // visually 'a'
      const middleRect = middleItem.getBoundingClientRect();
      const midSpanPoint = { x: middleRect.left + middleRect.width / 2, y: middleRect.top + middleRect.height / 2 };

      await span.dragOver(middleItem, midSpanPoint);
      expect(middleItem.hasAttribute('data-drop-position')).toBe(true);

      await span.dragOver(root(), midSpanPoint);

      // The span is now derived from every item's CURRENT rect (min top to
      // max bottom across c, a, b as actually laid out), not registration
      // order — so a point squarely inside the visual list correctly keeps
      // 'a' sticky, even reported via the root/container native target.
      expect(middleItem.hasAttribute('data-drop-position')).toBe(true);
      expect(root().hasAttribute('data-drop-container')).toBe(false);

      // Beyond the visual trailing edge (into the root's trailing padding,
      // below 'b' — the visually last item post-reorder): stickiness
      // releases and the container-append target takes over.
      const lastVisualRect = item(2).getBoundingClientRect(); // visually 'b'
      const beyondVisualSpan = { x: midSpanPoint.x, y: lastVisualRect.bottom + 30 };
      await span.dragOver(root(), beyondVisualSpan);

      expect(middleItem.hasAttribute('data-drop-position')).toBe(false);
      expect(root().getAttribute('data-drop-container')).toBe('active');

      await span.drop(root(), beyondVisualSpan);

      expect(host.drops.map(({ sourceId, targetId, edge }) => ({ sourceId, targetId, edge })))
        .toEqual([{ sourceId: 'b', targetId: null, edge: null }]);
    });
  });

  describe('explicit root + list on the same element', () => {
    @Component({
      imports: [OpSortableListsDirective, OpSortableListsListDirective, OpSortableListsItemDirective],
      template: `
        <div class="root" opSortableLists opSortableListsList>
          @for (id of ids(); track id) {
            <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
          }
        </div>
      `,
    })
    class RootListSameElementHostComponent {
      ids = signal(['a', 'b', 'c']);

      rootDirective = viewChild.required(OpSortableListsDirective);

      listDirective = viewChild.required(OpSortableListsListDirective);
    }

    let fixture:ComponentFixture<RootListSameElementHostComponent>;
    let host:RootListSameElementHostComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [RootListSameElementHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(RootListSameElementHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    function item(index:number):HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.item')[index];
    }

    it('routes drops to the list output; the root proxy stays silent', async () => {
      // Both directives declare an output with the exact same public name
      // on the exact same host element, so a template binding of
      // `(opSortableListsDrop)` cannot tell them apart (Angular binds it to
      // every matching output). Spy the directive instances directly.
      const rootSpy = vi.spyOn(host.rootDirective().opSortableListsDrop, 'emit');
      const listSpy = vi.spyOn(host.listDirective().opSortableListsDrop, 'emit');

      const simulation = new NativeDragSimulation(item(0));
      await simulation.start();
      await simulation.drop(item(2), towardsEdgeOf(item(2), 'bottom'));

      expect(rootSpy).not.toHaveBeenCalled();
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(listSpy.mock.calls[0][0]).toMatchObject({ sourceId: 'a', targetId: 'c', edge: 'bottom' });
    });
  });

  describe('two explicit lists sharing one root', () => {
    type LoggedEvent =
      | { type:'drop'; listId:'a'|'b'; event:SortableListsDropEvent }
      | { type:'removed'; listId:'a'|'b'; event:SortableListsRemovedEvent };

    // Type-predicate lookup instead of an `as Extract<...>` cast: narrows to
    // the requested variant and fails loudly (rather than silently typing a
    // `.find()` miss as present) if the event was never recorded.
    function findEvent<T extends LoggedEvent['type']>(
      events:LoggedEvent[],
      type:T,
    ):Extract<LoggedEvent, { type:T }> {
      const found = events.find((e):e is Extract<LoggedEvent, { type:T }> => e.type === type);
      if (!found) {
        throw new Error(`Expected a '${type}' event to have been recorded.`);
      }
      return found;
    }

    @Component({
      imports: [OpSortableListsDirective, OpSortableListsListDirective, OpSortableListsItemDirective],
      template: `
        <div class="root" opSortableLists>
          <div
            class="list-a"
            opSortableListsList
            opSortableListsListId="list-a"
            (opSortableListsDrop)="events.push({ type: 'drop', listId: 'a', event: $event })"
            (opSortableListsRemoved)="events.push({ type: 'removed', listId: 'a', event: $event })"
          >
            @for (id of idsA(); track id) {
              <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
            }
          </div>

          <div
            class="list-b"
            opSortableListsList
            opSortableListsListId="list-b"
            (opSortableListsDrop)="events.push({ type: 'drop', listId: 'b', event: $event })"
            (opSortableListsRemoved)="events.push({ type: 'removed', listId: 'b', event: $event })"
          >
            @for (id of idsB(); track id) {
              <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
            }
          </div>
        </div>
      `,
    })
    class TwoListsHostComponent {
      idsA = signal(['a1', 'a2']);

      idsB = signal(['b1', 'b2']);

      events:LoggedEvent[] = [];
    }

    let fixture:ComponentFixture<TwoListsHostComponent>;
    let host:TwoListsHostComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [TwoListsHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(TwoListsHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    function rootEl():HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelector('.root')!;
    }

    function itemIn(list:'list-a'|'list-b', index:number):HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`.${list} .item`)[index];
    }

    it('emits removed on the source list before drop on the target list, cross-list', async () => {
      const simulation = new NativeDragSimulation(itemIn('list-a', 0));

      await simulation.start();
      await simulation.drop(itemIn('list-b', 0), towardsEdgeOf(itemIn('list-b', 0), 'top'));

      expect(host.events.map((e) => e.type)).toEqual(['removed', 'drop']);

      const removed = findEvent(host.events, 'removed');
      const drop = findEvent(host.events, 'drop');
      expect(removed.listId).toBe('a');
      expect(drop.listId).toBe('b');
      expect(removed.event.itemId).toBe('a1');
      expect(removed.event.transactionId).toBe(drop.event.transactionId);

      // `finalize()` is a working no-arg source-side settlement call.
      drop.event.complete(true);
      await removed.event.completion;
      removed.event.finalize();
      await Promise.resolve();
      await Promise.resolve();

      expect(rootEl().hasAttribute('data-sortable-lists-busy')).toBe(false);
    });

    it('same-list drop emits drop only; removed is never called', async () => {
      const simulation = new NativeDragSimulation(itemIn('list-a', 0));

      await simulation.start();
      await simulation.drop(itemIn('list-a', 1), towardsEdgeOf(itemIn('list-a', 1), 'bottom'));

      expect(host.events).toHaveLength(1);
      expect(host.events[0]).toMatchObject({ type: 'drop', listId: 'a' });
    });

    it('holds busy through a pending cross-list completion and releases after finalize', async () => {
      const simulation = new NativeDragSimulation(itemIn('list-a', 0));

      await simulation.start();
      await simulation.drop(itemIn('list-b', 0), towardsEdgeOf(itemIn('list-b', 0), 'top'));

      expect(rootEl().hasAttribute('data-sortable-lists-busy')).toBe(true);

      const removed = findEvent(host.events, 'removed');
      const drop = findEvent(host.events, 'drop');

      // Target handler rejects the drop.
      drop.event.complete(false);
      await expect(removed.event.completion).resolves.toBe(false);

      // Target has settled; source has not finalized yet — still busy.
      expect(rootEl().hasAttribute('data-sortable-lists-busy')).toBe(true);

      removed.event.finalize();
      await Promise.resolve();
      await Promise.resolve();

      expect(rootEl().hasAttribute('data-sortable-lists-busy')).toBe(false);
    });
  });

  describe('dynamic first-list registration', () => {
    @Component({
      imports: [OpSortableListsDirective, OpSortableListsListDirective, OpSortableListsItemDirective],
      template: `
        <div class="root" opSortableLists (opSortableListsDrop)="rootDrops.push($event)">
          @if (explicit()) {
            <div
              class="list"
              opSortableListsList
              (opSortableListsDrop)="listDrops.push($event)"
            >
              @for (id of ids(); track id) {
                <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
              }
            </div>
          } @else {
            @for (id of ids(); track id) {
              <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
            }
          }
        </div>
      `,
    })
    class DynamicListHostComponent {
      explicit = signal(false);

      ids = signal(['a', 'b', 'c']);

      rootDrops:SortableListsDropEvent[] = [];

      listDrops:SortableListsDropEvent[] = [];
    }

    let fixture:ComponentFixture<DynamicListHostComponent>;
    let host:DynamicListHostComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [DynamicListHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(DynamicListHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    function item(index:number):HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.item')[index];
    }

    async function dragFirstOntoLast():Promise<void> {
      const simulation = new NativeDragSimulation(item(0));
      await simulation.start();
      await simulation.drop(item(2), towardsEdgeOf(item(2), 'bottom'));
    }

    it('hands drops from the root proxy to the list output and back as the child toggles', async () => {
      // Every drop here is same-list, so `complete()` alone releases busy —
      // but it must actually be called between drags, or the root stays
      // busy and every later `canDrag`/`canDrop` check short-circuits false.
      async function settle(event:SortableListsDropEvent):Promise<void> {
        event.complete(true);
        await Promise.resolve();
      }

      // OFF: no explicit list yet — root is in implicit collapse mode.
      await dragFirstOntoLast();
      expect(host.rootDrops).toHaveLength(1);
      expect(host.listDrops).toHaveLength(0);
      await settle(host.rootDrops[0]);
      host.rootDrops = [];

      // ON: the explicit list registers, retiring the implicit list.
      host.explicit.set(true);
      fixture.detectChanges();

      await dragFirstOntoLast();
      expect(host.rootDrops).toHaveLength(0);
      expect(host.listDrops).toHaveLength(1);
      await settle(host.listDrops[0]);
      host.listDrops = [];

      // OFF again: the explicit list unregisters, and implicit collapse
      // resumes on the root element itself.
      host.explicit.set(false);
      fixture.detectChanges();

      await dragFirstOntoLast();
      expect(host.rootDrops).toHaveLength(1);
      expect(host.listDrops).toHaveLength(0);
    });
  });

  describe('nested roots', () => {
    @Component({
      imports: [OpSortableListsDirective, OpSortableListsItemDirective],
      template: `
        <div class="outer-root" opSortableLists (opSortableListsDrop)="outerDrops.push($event)">
          <div class="outer-item" opSortableListsItem="outer-a" style="height: 40px; width: 200px;">outer-a</div>

          <div class="inner-root" opSortableLists (opSortableListsDrop)="innerDrops.push($event)">
            @for (id of innerIds(); track id) {
              <div class="item" [opSortableListsItem]="id" style="height: 40px; width: 200px;">{{ id }}</div>
            }
          </div>
        </div>
      `,
    })
    class NestedRootsHostComponent {
      innerIds = signal(['b1', 'b2', 'b3']);

      outerDrops:SortableListsDropEvent[] = [];

      innerDrops:SortableListsDropEvent[] = [];
    }

    let fixture:ComponentFixture<NestedRootsHostComponent>;
    let host:NestedRootsHostComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [NestedRootsHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(NestedRootsHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    function innerItem(index:number):HTMLElement {
      return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.inner-root .item')[index];
    }

    it("resolves an inner root's items to the inner root; the outer root stays silent", async () => {
      const simulation = new NativeDragSimulation(innerItem(0));

      await simulation.start();
      await simulation.drop(innerItem(2), towardsEdgeOf(innerItem(2), 'bottom'));

      expect(host.innerDrops).toHaveLength(1);
      expect(host.innerDrops[0]).toMatchObject({ sourceId: 'b1', targetId: 'b3', edge: 'bottom' });
      expect(host.outerDrops).toHaveLength(0);
    });
  });
});
