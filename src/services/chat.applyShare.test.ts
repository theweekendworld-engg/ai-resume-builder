/**
 * Web chat parity for share and go: "apply to this <link>" is analysed with
 * the apply goal, without a router call, when code is sure of the note.
 */

import { describe, expect, test } from 'bun:test';
import { applyShareRoute } from './chat';

const JOB = 'https://jobs.lever.co/acme/123';

describe('applyShareRoute', () => {
    test('a link with an apply note is an analysis, routed in code', () => {
        expect(applyShareRoute(`apply for me ${JOB}`)).toMatchObject({ action: 'analyze_job', url: JOB, text: null });
        expect(applyShareRoute(`${JOB}\nsend my resume`)).toMatchObject({ action: 'analyze_job', url: JOB });
    });

    test('a pasted post with "apply for me" on top keeps the post as the text', () => {
        const post = `Forward Deployed AI Engineer at Acme. ${'You will build agents with customers. '.repeat(8)}`.trim();
        expect(applyShareRoute(`apply for me\n\n${post}`)).toMatchObject({ action: 'analyze_job', url: null, text: post });
    });

    test('anything less certain goes to the router as before', () => {
        expect(applyShareRoute(JOB)).toBeNull();
        expect(applyShareRoute(`should I apply? ${JOB}`)).toBeNull();
        expect(applyShareRoute('apply for me')).toBeNull();
        expect(applyShareRoute('tailor my resume for the Acme job')).toBeNull();
    });
});
