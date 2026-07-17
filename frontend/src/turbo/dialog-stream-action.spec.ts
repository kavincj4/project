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
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { StreamActions } from '@hotwired/turbo';
import { registerDialogStreamAction } from './dialog-stream-action';

interface DialogCloseDetail {
  dialog:HTMLDialogElement;
  submitted:boolean;
  additional?:unknown;
}

describe('registerDialogStreamAction', () => {
  let controller:AbortController;
  let closeEvents:CustomEvent<DialogCloseDetail>[];

  beforeEach(() => {
    registerDialogStreamAction();
    controller = new AbortController();
    closeEvents = [];
    document.addEventListener('dialog:close', (event) => {
      closeEvents.push(event as CustomEvent<DialogCloseDetail>);
    }, { signal: controller.signal });
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function showDialog(content:string, id = 'test-dialog'):HTMLDialogElement {
    const element = document.createElement('turbo-stream');
    element.innerHTML = `<template><dialog-helper><dialog id="${id}">${content}</dialog></dialog-helper></template>`;
    StreamActions.dialog.call(element);

    return document.getElementById(id) as HTMLDialogElement;
  }

  function closeDialog(attributes:Record<string, string>):void {
    const element = document.createElement('turbo-stream');
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    StreamActions.closeDialog.call(element);
  }

  it('appends and shows a new dialog', () => {
    const dialog = showDialog('<p>Initial content</p>');

    expect(dialog.parentElement?.tagName).toBe('DIALOG-HELPER');
    expect(dialog.open).toBe(true);
  });

  it('removes a newly streamed dialog and reports an unsuccessful close', async () => {
    const dialog = showDialog('<p>Initial content</p>');
    const closed = new Promise<void>((resolve) => dialog.addEventListener('close', () => resolve(), { once: true }));

    dialog.close();
    await closed;

    expect(document.getElementById(dialog.id)).toBeNull();
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].detail).toEqual({ dialog, submitted: false });
  });

  it('reports a submitted close with additional data without dispatching a duplicate event', async () => {
    const dialog = showDialog('<p>Initial content</p>');
    const closed = new Promise<void>((resolve) => dialog.addEventListener('close', () => resolve(), { once: true }));

    closeDialog({ target: '#test-dialog', additional: '{"workPackageId":42}' });
    await closed;

    expect(dialog.open).toBe(false);
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].detail).toEqual({
      dialog,
      submitted: true,
      additional: { workPackageId: 42 },
    });
  });

  it('morphs and reopens the existing dialog when the same id is streamed again', () => {
    const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const dialog = showDialog('<p>Initial content</p>');

    showDialog('<h2>Updated content</h2>');

    expect(document.querySelectorAll('#test-dialog')).toHaveLength(1);
    expect(document.getElementById('test-dialog')).toBe(dialog);
    expect(dialog.innerHTML).toBe('<h2>Updated content</h2>');
    expect(showModalSpy).toHaveBeenCalledTimes(2);
    expect(showModalSpy.mock.contexts[1]).toBe(dialog);
  });

  it('adjusts the dialog width after it is shown', () => {
    vi.useFakeTimers();
    const dialog = showDialog('<p>Initial content</p>');
    Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: 320 });

    vi.advanceTimersByTime(250);

    expect(dialog.style.width).toBe('321px');
  });
});
