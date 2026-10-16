import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getWorkspaceImportImpact, hasWorkspaceImportShape, matchesWorkspaceImportReview } from '../src/imports/workspaceImport';
import { WorkspaceImportDialog } from '../src/features/workspace/components/WorkspaceImportDialog';
import { normalizeAppData } from '../src/store/utils';

test('import review supports existing and legacy backup shapes and only exposes aggregate impact', () => {
  for (const value of [null, 'private contents', {}, { classes: 'invalid' }]) assert.equal(hasWorkspaceImportShape(value), false);
  assert.equal(hasWorkspaceImportShape({ students: [] }), true);
  assert.equal(hasWorkspaceImportShape({ classes: [] }), true);
  const data = normalizeAppData({ classes: [{ id: 'PRIVATE-ID', name: 'PRIVATE-NAME', students: [{
    id: 'PRIVATE-STUDENT-ID', name: 'PRIVATE-STUDENT-NAME', points: 987,
    pet: { type: 'cat', fullness: 73, happiness: 61, level: 4 },
  }] }, { id: 'archive', name: 'PRIVATE-ARCHIVE', archivedAt: 123, students: [] }] });
  const impact = getWorkspaceImportImpact(data);
  assert.deepEqual(impact, { classes: 2, archived: 1, students: 1, evidence: 0, exams: 0 });
  assert.equal(JSON.stringify(impact).includes('PRIVATE'), false);
  const html = renderToStaticMarkup(createElement(WorkspaceImportDialog, {
    review: { workspaceId: 'workspace', workspaceName: 'Synthetic workspace', expectedRevision: 7,
      data, currentImpact: impact, incomingImpact: impact },
    language: 'en', busy: false, error: '', onClose: () => undefined, onReplace: () => undefined,
  }));
  assert.match(html, /Type IMPORT WORKSPACE/);
  assert.match(html, /High risk/);
  assert.doesNotMatch(html, /PRIVATE|987/);
});

test('backup confirmation is pinned to the reviewed workspace and exact revision, not only counts', () => {
  const reviewed = { workspaceId: 'reviewed-workspace', expectedRevision: 7 };
  assert.equal(matchesWorkspaceImportReview(reviewed, 'reviewed-workspace', 7), true);
  assert.equal(matchesWorkspaceImportReview(reviewed, 'other-workspace', 7), false);
  assert.equal(matchesWorkspaceImportReview(reviewed, 'reviewed-workspace', 8), false);
});
