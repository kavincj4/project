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
  NativeDragSimulation,
  centerOf,
  towardsEdgeOf,
} from 'core-common/drag-and-drop/testing/native-drag-simulation';
import {
  createSortableRoot,
  type SortableDropIntent,
  type SortableDropTransaction,
  type SortableSource,
} from './sortable-lists-engine';

function buildList(items:string[]):{ root:HTMLElement; rows:HTMLElement[] } {
  const root = document.createElement('div');
  const rows = items.map((id) => {
    const row = document.createElement('div');
    row.style.cssText = 'height:20px;';
    row.textContent = id;
    root.appendChild(row);
    return row;
  });
  document.body.appendChild(root);
  return { root, rows };
}

// A list rendered as its own element inside a wrapping root, for cross-list
// scenarios where the root spans multiple `registerList` instances.
function buildListIn(root:HTMLElement, items:string[]):{ element:HTMLElement; rows:HTMLElement[] } {
  const element = document.createElement('div');
  const rows = items.map((id) => {
    const row = document.createElement('div');
    row.style.cssText = 'height:20px;';
    row.textContent = id;
    element.appendChild(row);
    return row;
  });
  root.appendChild(element);
  return { element, rows };
}

// A horizontal list of fixed-width chips, for axis:'horizontal' scenarios.
function buildHorizontalList(items:string[]):{ root:HTMLElement; chips:HTMLElement[] } {
  const root = document.createElement('div');
  root.style.cssText = 'white-space:nowrap;';
  const chips = items.map((id) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:inline-block; width:40px; height:20px;';
    chip.textContent = id;
    root.appendChild(chip);
    return chip;
  });
  document.body.appendChild(root);
  return { root, chips };
}

describe('createSortableRoot', () => {
  let cleanupFns:(() => void)[] = [];

  afterEach(() => {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    document.body.replaceChildren();
  });

  function setup(items:string[] = ['a', 'b', 'c']) {
    const { root, rows } = buildList(items);
    const intents:SortableDropIntent[] = [];
    const cancels:SortableSource[] = [];
    const transactions:SortableDropTransaction[] = [];

    const sortableRoot = createSortableRoot({
      element: root,
      onDrop: (transaction) => {
        intents.push(transaction.intent);
        transactions.push(transaction);
      },
      onCancel: (source) => cancels.push(source),
    });

    const listCleanup = sortableRoot.registerList({ element: root, listId: 'l1' });
    const itemCleanups = rows.map((row, index) => sortableRoot.registerItem({
      element: row,
      itemId: items[index],
      listId: 'l1',
    }));

    cleanupFns.push(listCleanup, ...itemCleanups, () => sortableRoot.destroy());

    return {
      root, rows, intents, cancels, transactions, sortableRoot,
    };
  }

  // Two lists ('l1', 'l2') sharing one root, for cross-list transaction
  // scenarios (busy gating, `accepts`, settlement across list boundaries).
  function setupTwoLists(opts:{
    itemsA?:string[];
    itemsB?:string[];
    acceptsB?:(args:{ source:SortableSource }) => boolean;
  } = {}) {
    const itemsA = opts.itemsA ?? ['a1', 'a2'];
    const itemsB = opts.itemsB ?? ['b1', 'b2'];

    const root = document.createElement('div');
    document.body.appendChild(root);
    const listA = buildListIn(root, itemsA);
    const listB = buildListIn(root, itemsB);

    const intents:SortableDropIntent[] = [];
    const transactions:SortableDropTransaction[] = [];

    const sortableRoot = createSortableRoot({
      element: root,
      onDrop: (transaction) => {
        intents.push(transaction.intent);
        transactions.push(transaction);
      },
    });

    const cleanupA = sortableRoot.registerList({ element: listA.element, listId: 'l1' });
    const cleanupB = sortableRoot.registerList({ element: listB.element, listId: 'l2', accepts: opts.acceptsB });
    const itemCleanupsA = listA.rows.map((row, index) => sortableRoot.registerItem({
      element: row,
      itemId: itemsA[index],
      listId: 'l1',
    }));
    const itemCleanupsB = listB.rows.map((row, index) => sortableRoot.registerItem({
      element: row,
      itemId: itemsB[index],
      listId: 'l2',
    }));

    cleanupFns.push(cleanupA, cleanupB, ...itemCleanupsA, ...itemCleanupsB, () => sortableRoot.destroy());

    return {
      root, listA, listB, intents, transactions, sortableRoot,
    };
  }

  it('resolves a bottom-edge item drop to exactly one intent', async () => {
    const { rows, intents } = setup();
    const simulation = new NativeDragSimulation(rows[0]);

    await simulation.start();
    await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

    expect(intents).toEqual([{
      sourceId: 'a',
      sourceListId: 'l1',
      targetListId: 'l1',
      targetItemId: 'c',
      edge: 'bottom',
    }]);
  });

  it('resolves a drop on container space to an append intent', async () => {
    const { root, rows, intents } = setup();
    root.style.cssText = 'padding-bottom:40px;';
    const simulation = new NativeDragSimulation(rows[0]);
    const rootRect = root.getBoundingClientRect();
    const belowRows = { x: rootRect.left + rootRect.width / 2, y: rootRect.bottom - 5 };

    await simulation.start();
    await simulation.drop(root, belowRows);

    expect(intents).toEqual([{
      sourceId: 'a',
      sourceListId: 'l1',
      targetListId: 'l1',
      targetItemId: null,
      edge: null,
    }]);
  });

  it('self-drop produces no intent', async () => {
    const { rows, intents } = setup();
    const simulation = new NativeDragSimulation(rows[1]);

    await simulation.start();
    await simulation.drop(rows[1], centerOf(rows[1]));

    expect(intents).toEqual([]);
  });

  it('drop outside every registered list cancels', async () => {
    const { rows, intents, cancels } = setup();
    const outside = document.createElement('div');
    outside.style.cssText = 'position:fixed; top:500px; left:500px; width:50px; height:50px;';
    document.body.appendChild(outside);
    const simulation = new NativeDragSimulation(rows[0]);

    await simulation.start();
    await simulation.drop(outside, centerOf(outside));

    expect(cancels).toEqual([{ itemId: 'a', listId: 'l1', element: rows[0] }]);
    expect(intents).toEqual([]);
  });

  it('writes the dragging and indicator attributes', async () => {
    const { rows } = setup();
    const simulation = new NativeDragSimulation(rows[0]);

    await simulation.start();
    expect(rows[0].dataset.dragging).toBe('source');

    await simulation.dragOver(rows[2], towardsEdgeOf(rows[2], 'bottom'));
    expect(rows[2].getAttribute('data-drop-position')).toBe('bottom');
    expect(rows[2].getAttribute('data-drop-position-owner')).toBe('c');

    await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

    expect(rows[0].hasAttribute('data-dragging')).toBe(false);
    expect(rows[2].hasAttribute('data-drop-position')).toBe(false);
  });

  it('data-drop-container is active only for a list-only target', async () => {
    const { root, rows } = setup();
    root.style.cssText = 'padding-bottom:40px;';
    const simulation = new NativeDragSimulation(rows[0]);

    await simulation.start();

    await simulation.dragOver(rows[2], towardsEdgeOf(rows[2], 'bottom'));
    expect(root.hasAttribute('data-drop-container')).toBe(false);

    const rootRect = root.getBoundingClientRect();
    const belowRows = { x: rootRect.left + rootRect.width / 2, y: rootRect.bottom - 5 };
    await simulation.dragOver(root, belowRows);
    expect(root.getAttribute('data-drop-container')).toBe('active');
    expect(rows[2].hasAttribute('data-drop-position')).toBe(false);

    await simulation.cancel();
  });

  it('suppresses the drop indicator while hovering the drag source itself', async () => {
    const { rows } = setup();
    const simulation = new NativeDragSimulation(rows[0]);

    await simulation.start();
    expect(rows[0].dataset.dragging).toBe('source');

    // Mid-drag: hover the source row over itself. The row is still a valid
    // Pragmatic drop target (canDrop must accept self, see the engine's
    // comment), but it must not render a drop-position line on itself.
    await simulation.dragOver(rows[0], centerOf(rows[0]));

    expect(rows[0].dataset.dragging).toBe('source');
    expect(rows[0].hasAttribute('data-drop-position')).toBe(false);
    expect(rows[0].hasAttribute('data-drop-position-owner')).toBe(false);

    await simulation.cancel();
  });

  it('destroy is idempotent and unregisters every registration', async () => {
    const { rows, intents, sortableRoot } = setup();

    expect(() => {
      sortableRoot.destroy();
      sortableRoot.destroy();
    }).not.toThrow();

    const simulation = new NativeDragSimulation(rows[0]);
    await simulation.start();
    await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

    expect(intents).toEqual([]);
  });

  describe('transaction lifecycle', () => {
    it('defers completion resolution past a synchronous complete() call', async () => {
      const { root, rows } = buildList(['a', 'b', 'c']);
      const order:string[] = [];

      const sortableRoot = createSortableRoot({
        element: root,
        onDrop: (transaction) => {
          // Attach before completing, so the reaction is scheduled the
          // moment the transaction actually resolves (whenever that is).
          void transaction.completion.then(() => order.push('completion'));
          transaction.complete(true);
          // Queued after complete() inside the same synchronous callback: if
          // completion resolved eagerly this microtask would still run
          // after the (synchronous) resolution — the real signal is queued
          // in the assertion below via a *second* microtask hop.
          queueMicrotask(() => order.push('queued-after-complete'));
        },
      });
      const listCleanup = sortableRoot.registerList({ element: root, listId: 'l1' });
      const itemCleanups = rows.map((row, index) => sortableRoot.registerItem({
        element: row,
        itemId: ['a', 'b', 'c'][index],
        listId: 'l1',
      }));
      cleanupFns.push(listCleanup, ...itemCleanups, () => sortableRoot.destroy());

      const simulation = new NativeDragSimulation(rows[0]);
      await simulation.start();
      await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

      // complete() defers its own resolution by one microtask hop, so the
      // microtask queued right after it in onDrop still runs first.
      expect(order).toEqual(['queued-after-complete', 'completion']);
    });

    it('complete is idempotent; the first call wins', async () => {
      const { rows, transactions } = setup();
      const simulation = new NativeDragSimulation(rows[0]);

      await simulation.start();
      await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

      const transaction = transactions[0];
      transaction.complete(true);
      transaction.complete(false);

      await expect(transaction.completion).resolves.toBe(true);
    });

    it('finalize is idempotent', async () => {
      const { root, rows, transactions } = setup();
      const simulation = new NativeDragSimulation(rows[0]);

      await simulation.start();
      await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

      const transaction = transactions[0];

      expect(() => {
        transaction.finalize();
        transaction.finalize();
      }).not.toThrow();

      transaction.complete(true);
      await transaction.completion;

      expect(root.hasAttribute('data-sortable-lists-busy')).toBe(false);
    });

    it('busy gates a second drag until both sides settle', async () => {
      const { listA, listB, root, transactions } = setupTwoLists();

      const simulation = new NativeDragSimulation(listA.rows[0]);
      await simulation.start();
      await simulation.drop(listB.rows[0], towardsEdgeOf(listB.rows[0], 'top'));

      expect(root.getAttribute('data-sortable-lists-busy')).toBe('true');
      expect(transactions).toHaveLength(1);
      const transaction = transactions[0];

      // A second drag attempt while busy resolves no intent.
      const second = new NativeDragSimulation(listA.rows[1]);
      await second.start();
      await second.drop(listB.rows[1], towardsEdgeOf(listB.rows[1], 'top'));
      expect(transactions).toHaveLength(1);

      // Target side settles, source side does not: still busy, still gated.
      transaction.complete(true);
      await transaction.completion;
      expect(root.getAttribute('data-sortable-lists-busy')).toBe('true');

      const third = new NativeDragSimulation(listA.rows[1]);
      await third.start();
      await third.drop(listB.rows[1], towardsEdgeOf(listB.rows[1], 'top'));
      expect(transactions).toHaveLength(1);

      // Source side finalizes: busy releases and dragging works again.
      transaction.finalize();
      await Promise.resolve();
      await Promise.resolve();
      expect(root.hasAttribute('data-sortable-lists-busy')).toBe(false);

      const fourth = new NativeDragSimulation(listA.rows[1]);
      await fourth.start();
      await fourth.drop(listB.rows[1], towardsEdgeOf(listB.rows[1], 'top'));
      expect(transactions).toHaveLength(2);
    });

    it('same-list transactions settle on complete alone', async () => {
      const { root, rows, transactions } = setup();
      const simulation = new NativeDragSimulation(rows[0]);

      await simulation.start();
      await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

      expect(root.getAttribute('data-sortable-lists-busy')).toBe('true');

      const transaction = transactions[0];
      transaction.complete(true);
      await transaction.completion;

      expect(root.hasAttribute('data-sortable-lists-busy')).toBe(false);
    });

    it('resolves a cross-list drop intent', async () => {
      const { listA, listB, transactions } = setupTwoLists();

      const simulation = new NativeDragSimulation(listA.rows[0]);
      await simulation.start();
      await simulation.drop(listB.rows[0], towardsEdgeOf(listB.rows[0], 'top'));

      expect(transactions).toHaveLength(1);
      expect(transactions[0].intent).toMatchObject({
        sourceListId: 'l1',
        targetListId: 'l2',
      });

      // Settle explicitly: a cross-list transaction that's never completed
      // and finalized leaves its 10s diagnostic timer pending, which must
      // not depend on the surrounding `destroy()` cleanup to avoid leaking.
      const transaction = transactions[0];
      transaction.complete(true);
      transaction.finalize();
      await transaction.completion;
    });

    it('accepts gates both the item and container drop targets of the list', async () => {
      const { listA, listB, transactions } = setupTwoLists({ acceptsB: () => false });

      const simulation = new NativeDragSimulation(listA.rows[0]);
      await simulation.start();

      // Mid-drag: no indicator on the rejected list's item target.
      await simulation.dragOver(listB.rows[0], towardsEdgeOf(listB.rows[0], 'top'));
      expect(listB.rows[0].hasAttribute('data-drop-position')).toBe(false);

      await simulation.drop(listB.rows[0], towardsEdgeOf(listB.rows[0], 'top'));
      expect(transactions).toEqual([]);

      // Container space of the same list is gated too.
      const second = new NativeDragSimulation(listA.rows[1]);
      await second.start();
      listB.element.style.cssText = 'height:20px; padding-bottom:40px;';
      const listBRect = listB.element.getBoundingClientRect();
      const belowRows = { x: listBRect.left + listBRect.width / 2, y: listBRect.bottom - 5 };
      await second.drop(listB.element, belowRows);

      expect(transactions).toEqual([]);
    });

    it('logs a diagnostic for an unsettled transaction after 10s', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        // Fake only the timer the diagnostic relies on: the drag simulation
        // still needs real animation frames to progress.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        const { root, rows, transactions } = setup();
        const simulation = new NativeDragSimulation(rows[0]);
        await simulation.start();
        await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

        const transaction = transactions[0];
        vi.advanceTimersByTime(10_000);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(transaction.id));
        expect(root.getAttribute('data-sortable-lists-busy')).toBe('true');
      } finally {
        vi.useRealTimers();
        warn.mockRestore();
      }
    });

    it('destroy cancels a pending unsettled-transaction diagnostic', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        // Fake only the timer the diagnostic relies on: the drag simulation
        // still needs real animation frames to progress.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        const { rows, transactions, sortableRoot } = setup();
        const simulation = new NativeDragSimulation(rows[0]);
        await simulation.start();
        await simulation.drop(rows[2], towardsEdgeOf(rows[2], 'bottom'));

        const transaction = transactions[0];
        warn.mockClear(); // drop the unrelated "Auto scrolling..." registration noise

        // Never settled: destroy() must cancel its diagnostic timer instead
        // of leaving it to warn after the root is already torn down.
        sortableRoot.destroy();
        vi.advanceTimersByTime(10_000);

        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(transaction.id));
      } finally {
        vi.useRealTimers();
        warn.mockRestore();
      }
    });
  });

  describe('bounded stickiness (item→list handoff)', () => {
    it('sticky item target releases beyond the items span (vertical)', async () => {
      const { root, rows } = setup();
      root.style.cssText = 'padding-bottom:40px;';
      const simulation = new NativeDragSimulation(rows[0]);
      const lastRect = rows[2].getBoundingClientRect();
      const midSpanPoint = centerOf(rows[2]);

      await simulation.start();
      await simulation.dragOver(rows[2], midSpanPoint);
      expect(rows[2].hasAttribute('data-drop-position')).toBe(true);

      // Dispatched directly on the list element — as a real dragover over a
      // gap between rows would be — but the pointer coordinate is still
      // within the items span: the item stays the resolved target (Pragmatic
      // stickiness) instead of immediately handing off to the list.
      await simulation.dragOver(root, midSpanPoint);
      expect(rows[2].hasAttribute('data-drop-position')).toBe(true);
      expect(root.hasAttribute('data-drop-container')).toBe(false);

      // Beyond the items span (30px past the last row's bottom edge, still
      // inside the list element thanks to the padding added above): the item
      // releases and the list's own container target takes over.
      const beyondSpan = { x: midSpanPoint.x, y: lastRect.bottom + 30 };
      await simulation.dragOver(root, beyondSpan);
      expect(rows[2].hasAttribute('data-drop-position')).toBe(false);
      expect(root.getAttribute('data-drop-container')).toBe('active');

      await simulation.cancel();
    });

    it('sticky handoff works horizontally', async () => {
      const { root, chips } = buildHorizontalList(['a', 'b', 'c']);
      root.style.cssText = 'white-space:nowrap; padding-right:40px;';
      const intents:SortableDropIntent[] = [];

      const sortableRoot = createSortableRoot({
        element: root,
        axis: 'horizontal',
        onDrop: (transaction) => intents.push(transaction.intent),
      });
      const listCleanup = sortableRoot.registerList({ element: root, listId: 'l1' });
      const itemCleanups = chips.map((chip, index) => sortableRoot.registerItem({
        element: chip,
        itemId: ['a', 'b', 'c'][index],
        listId: 'l1',
      }));
      cleanupFns.push(listCleanup, ...itemCleanups, () => sortableRoot.destroy());

      const simulation = new NativeDragSimulation(chips[0]);
      const lastRect = chips[2].getBoundingClientRect();
      const midSpanPoint = centerOf(chips[2]);

      await simulation.start();
      await simulation.dragOver(chips[2], midSpanPoint);
      expect(chips[2].hasAttribute('data-drop-position')).toBe(true);

      // Same handoff as the vertical case, but along the horizontal axis:
      // dispatched on the list directly, still within the chips span.
      await simulation.dragOver(root, midSpanPoint);
      expect(chips[2].hasAttribute('data-drop-position')).toBe(true);
      expect(root.hasAttribute('data-drop-container')).toBe(false);

      const beyondSpan = { x: lastRect.right + 30, y: midSpanPoint.y };
      await simulation.dragOver(root, beyondSpan);
      expect(chips[2].hasAttribute('data-drop-position')).toBe(false);
      expect(root.getAttribute('data-drop-container')).toBe('active');

      await simulation.drop(root, beyondSpan);
      expect(intents).toEqual([{
        sourceId: 'a',
        sourceListId: 'l1',
        targetListId: 'l1',
        targetItemId: null,
        edge: null,
      }]);
    });
  });

  describe('drag-start gating', () => {
    it('drag does not start from an interactive descendant', async () => {
      const { rows } = setup(['a']);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Actions';
      button.style.cssText = 'display:block; width:16px; height:16px;';
      rows[0].appendChild(button);

      const simulation = new NativeDragSimulation(rows[0]);
      await simulation.start(centerOf(button));

      expect(rows[0].hasAttribute('data-dragging')).toBe(false);
    });

    it('consumer canDrag gate composes', async () => {
      const { root, rows } = buildList(['a', 'b']);
      const sortableRoot = createSortableRoot({ element: root, onDrop: () => undefined });
      const listCleanup = sortableRoot.registerList({ element: root, listId: 'l1' });
      const itemCleanupA = sortableRoot.registerItem({
        element: rows[0], itemId: 'a', listId: 'l1', canDrag: () => false,
      });
      const itemCleanupB = sortableRoot.registerItem({ element: rows[1], itemId: 'b', listId: 'l1' });
      cleanupFns.push(listCleanup, itemCleanupA, itemCleanupB, () => sortableRoot.destroy());

      const blocked = new NativeDragSimulation(rows[0]);
      await blocked.start();
      expect(rows[0].hasAttribute('data-dragging')).toBe(false);

      const allowed = new NativeDragSimulation(rows[1]);
      await allowed.start();
      expect(rows[1].dataset.dragging).toBe('source');

      await allowed.cancel();
    });
  });

  describe('custom preview factory', () => {
    it('custom preview factory renders and cleans up', async () => {
      const cleanup = vi.fn();
      const calls:{ source:SortableSource; container:HTMLElement }[] = [];
      let previewPresentAtDragStart = false;

      const { root, rows } = buildList(['a', 'b']);
      const sortableRoot = createSortableRoot({
        element: root,
        preview: ({ source, container }) => {
          calls.push({ source, container });
          container.append(Object.assign(document.createElement('div'), {
            className: 'test-preview',
            textContent: source.itemId,
          }));
          return cleanup;
        },
        onDragStarted: () => {
          // Pragmatic dispatches the item's own `onDragStart` before the
          // preview container's internal cleanup monitor runs (both are
          // notified from the same `onDragStart` broadcast), so the preview
          // element is still mounted at this exact synchronous point — this
          // is the only observable window before Pragmatic tears it down.
          previewPresentAtDragStart = document.querySelector('.test-preview') !== null;
        },
        onDrop: () => undefined,
      });
      const listCleanup = sortableRoot.registerList({ element: root, listId: 'l1' });
      const itemCleanups = rows.map((row, index) => sortableRoot.registerItem({
        element: row,
        itemId: ['a', 'b'][index],
        listId: 'l1',
      }));
      cleanupFns.push(listCleanup, ...itemCleanups, () => sortableRoot.destroy());

      const simulation = new NativeDragSimulation(rows[0]);
      await simulation.start();

      expect(calls).toHaveLength(1);
      expect(calls[0].source).toMatchObject({ itemId: 'a', listId: 'l1' });
      expect(calls[0].container).toBeInstanceOf(HTMLElement);
      expect(previewPresentAtDragStart).toBe(true);

      await simulation.drop(rows[1], towardsEdgeOf(rows[1], 'bottom'));

      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
