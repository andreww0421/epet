import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { AuthProvider } from '../src/auth/AuthProvider';
import { PrivacyInformationPanel } from '../src/features/workspace/components/PrivacyInformationPanel';
import { WorkspaceDataPanel } from '../src/features/workspace/components/WorkspaceDataPanel';
import { StudentDataPanel } from '../src/features/workspace/components/StudentDataPanel';
import { DataGovernancePanel } from '../src/features/workspace/components/DataGovernancePanel';
import type { ClassData } from '../src/store/types';

test('a directly mounted workspace data panel fails closed before authentication is resolved', () => {
  let flushCalls = 0;
  const classroom: ClassData = {
    id: 'private-class-id',
    name: 'PRIVATE_CLASS_CANARY',
    archivedAt: 123,
    students: [{
      id: 'PRIVATE_STUDENT_ID_CANARY',
      name: 'PRIVATE_STUDENT_NAME_CANARY',
      points: 999,
      pet: { type: 'egg', fullness: 80, happiness: 80, level: 1 },
    }],
  };
  const html = renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(WorkspaceDataPanel, {
      classes: [classroom],
      language: 'en',
      flushChanges: async () => { flushCalls += 1; return true; },
    }),
  ));
  assert.match(html, /Only an admin or owner of the current workspace can manage data/);
  assert.doesNotMatch(html, /PRIVATE_|Download|Archive class|Reopen class/);
  assert.equal(flushCalls, 0);
});

test('a directly mounted privacy information panel does not expose settings or actions before authentication resolves', () => {
  let navigationCalls = 0;
  const html = renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(PrivacyInformationPanel, {
      language: 'en',
      settings: {
        decayAmount: 2,
        decayType: 'hourly',
        inclusiveMode: false,
        publicNameMode: 'full',
        publicLeaderboardMode: 'rank',
      },
      onOpenDisplaySettings: () => { navigationCalls += 1; },
    }),
  ));
  assert.match(html, /Only an admin or owner of the current workspace can manage privacy/);
  assert.doesNotMatch(html, /Full names|Game ranking|Manage student visibility/);
  assert.equal(navigationCalls, 0);
});

for (const [name, Component] of [['student data', StudentDataPanel], ['data governance', DataGovernancePanel]] as const) {
  test(`a directly mounted ${name} panel does not expose student data or trigger operations before authentication resolves`, () => {
    let flushCalls = 0;
    const classroom: ClassData = {
      id: 'PRIVATE_CLASS_ID_CANARY', name: 'PRIVATE_CLASS_NAME_CANARY',
      students: [{ id: 'PRIVATE_STUDENT_ID_CANARY', name: 'PRIVATE_STUDENT_NAME_CANARY', points: 987,
        pet: { type: 'egg', fullness: 80, happiness: 80, level: 1 } }],
    };
    const html = renderToStaticMarkup(createElement(AuthProvider, null,
      createElement(Component, { classes: [classroom], language: 'en',
        flushChanges: async () => { flushCalls += 1; return true; },
      }),
    ));
    assert.match(html, /Owner or admin access is required/);
    assert.doesNotMatch(html, /PRIVATE_|<select|<button|Export|Anonymize|Delete/);
    assert.equal(flushCalls, 0);
  });
}
