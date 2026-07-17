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

import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

// Drop indicator contract shared by the Angular sortable helpers: the closest
// edge is written to a `data-drop-position` attribute on the hovered element,
// along with a `data-drop-position-owner` attribute tracking which component
// rendered the indicator. The visual line is drawn by each consumer's own
// stylesheet via the `[data-drop-position="top|bottom|left|right"]` selector,
// since orientation (and therefore the styling) differs per surface.
export const dropPositionAttribute = 'data-drop-position';
export const dropPositionOwnerAttribute = 'data-drop-position-owner';

export function renderDropIndicator(element:HTMLElement, edge:Edge|null, ownerId:string):void {
  if (!edge) {
    clearDropIndicator(element, ownerId);
    return;
  }

  element.setAttribute(dropPositionAttribute, edge);
  element.setAttribute(dropPositionOwnerAttribute, ownerId);
}

export function clearDropIndicator(element:HTMLElement, ownerId:string):void {
  // Only clear if the stored owner matches; another owner may have rendered
  // an indicator since this one was set.
  if (element.getAttribute(dropPositionOwnerAttribute) === ownerId) {
    element.removeAttribute(dropPositionAttribute);
    element.removeAttribute(dropPositionOwnerAttribute);
  }
}
