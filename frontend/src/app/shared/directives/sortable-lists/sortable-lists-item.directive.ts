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
  DestroyRef,
  Directive,
  ElementRef,
  OnInit,
  inject,
  input,
} from '@angular/core';
import { OpSortableListsDirective } from './sortable-lists.directive';
import { OpSortableListsListDirective } from './sortable-lists-list.directive';

// One sortable item inside an `opSortableLists` root. Mirrors the Stimulus
// `sortable-lists--item` controller: it registers its host element with the
// shared sortable engine exactly once per directive instance, so Angular's
// view lifecycle (`@for` track) owns creation and destruction of the
// registration — registering in `ngOnInit` and cleaning up through
// `DestroyRef` keeps that registration strictly tied to the view, so a
// re-rendered item is a fresh registration rather than a stale one reused
// out of order.
//
// All drag/drop-position visual state (`data-dragging`, `data-drop-position`)
// is now written directly to the host element by the engine; this directive
// owns no host bindings of its own.
@Directive({
  selector: '[opSortableListsItem]',
})
export class OpSortableListsItemDirective implements OnInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly destroyRef = inject(DestroyRef);

  // Fails Angular injection loudly when the item is not placed inside an
  // `opSortableLists` ancestor, instead of silently becoming inert.
  private readonly root = inject(OpSortableListsDirective);

  // The nearest explicit list, if any; falls back to the root's own
  // implicit list when the item sits directly under a collapsed root.
  private readonly list = inject(OpSortableListsListDirective, { optional: true });

  itemId = input.required<string>({ alias: 'opSortableListsItem' });

  canDrag = input<boolean>(true, { alias: 'opSortableListsItemCanDrag' });

  ngOnInit():void {
    if (!this.itemId()) {
      console.warn(
        'opSortableListsItem requires a non-empty item id; this item will not be draggable.',
        this.elementRef.nativeElement,
      );
      return;
    }

    const cleanup = this.root.registerItem({
      element: this.elementRef.nativeElement,
      itemId: this.itemId(),
      listId: this.list?.listId() ?? this.root.implicitListId,
      canDrag: () => this.canDrag(),
    });

    this.destroyRef.onDestroy(cleanup);
  }
}
