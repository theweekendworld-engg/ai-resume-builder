/**
 * Reads a drafting prompt back into structured blocks.
 *
 * The eval's stub drafter works from the prompt string rather than from the
 * candidate object, and that is deliberate: it means the corpus run also proves
 * the prompt actually *carries* the title, the body and the linked issue. A
 * stub that read the context directly would happily pass while the prompt
 * builder dropped the linked issue on the floor.
 */

export type PromptBlock = {
    repo: string;
    repoPrivate: boolean;
    role: 'author' | 'reviewer';
    title: string;
    body: string;
    labels: string[];
    occurredOn: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    linkedIssueTitle: string;
    linkedIssueBody: string;
    reviewState: string;
    reviewBody: string;
    reviewCommentsByOthers: number;
};

const KEY_LINE = /^(repo|role|title|body|labels|merged|closed|files_changed|linked_issue|linked_issue_body|review_state|your_review|review_comments_by_others):/;
const PART_LINE = /^--- part \d+ of \d+ ---$/;

function emptyBlock(): PromptBlock {
    return {
        repo: '',
        repoPrivate: false,
        role: 'author',
        title: '',
        body: '',
        labels: [],
        occurredOn: '',
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        linkedIssueTitle: '',
        linkedIssueBody: '',
        reviewState: '',
        reviewBody: '',
        reviewCommentsByOthers: 0,
    };
}

function unquote(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith('"')) return trimmed;
    try {
        return JSON.parse(trimmed) as string;
    } catch {
        return trimmed.replace(/^"|"$/g, '');
    }
}

export function parsePromptBlocks(prompt: string): PromptBlock[] {
    const lines = prompt.split('\n');
    const blocks: PromptBlock[] = [];
    let current: PromptBlock | null = null;
    /** Which multi-line field we are currently accumulating into. */
    let sink: 'body' | 'linkedIssueBody' | 'reviewBody' | null = null;

    const flush = (): void => {
        if (current && (current.title || current.body)) blocks.push(current);
        current = null;
        sink = null;
    };

    for (const line of lines) {
        if (PART_LINE.test(line.trim())) {
            flush();
            current = emptyBlock();
            continue;
        }

        const isKey = KEY_LINE.test(line);
        if (!isKey && sink && current) {
            current[sink] = current[sink] ? `${current[sink]}\n${line}` : line;
            continue;
        }
        if (!isKey) continue;

        const separator = line.indexOf(':');
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();

        if (key === 'repo') {
            // A new `repo:` starts a block when we are not already inside one.
            if (current && current.title) flush();
            if (!current) current = emptyBlock();
            const match = /^(.*)\s\((private|public)\)$/.exec(value);
            current.repo = match ? match[1] : value;
            current.repoPrivate = match?.[2] === 'private';
            sink = null;
            continue;
        }

        if (!current) current = emptyBlock();
        sink = null;

        switch (key) {
            case 'role':
                current.role = value === 'reviewer' ? 'reviewer' : 'author';
                break;
            case 'title':
                current.title = unquote(value);
                break;
            case 'body':
                current.body = value === '(empty)' ? '' : value;
                sink = 'body';
                break;
            case 'labels':
                current.labels = value
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map((label) => label.trim())
                    .filter(Boolean);
                break;
            case 'merged':
            case 'closed':
                current.occurredOn = value;
                break;
            case 'files_changed': {
                const numbers = value.match(/\d+/g) ?? [];
                current.filesChanged = Number(numbers[0] ?? 0);
                current.additions = Number(numbers[1] ?? 0);
                current.deletions = Number(numbers[2] ?? 0);
                break;
            }
            case 'linked_issue':
                current.linkedIssueTitle = unquote(value.replace(/\s*\(#\d+\)\s*$/, ''));
                break;
            case 'linked_issue_body':
                current.linkedIssueBody = value;
                sink = 'linkedIssueBody';
                break;
            case 'review_state':
                current.reviewState = value;
                break;
            case 'your_review':
                current.reviewBody = value === '(empty)' ? '' : value;
                sink = 'reviewBody';
                break;
            case 'review_comments_by_others':
                current.reviewCommentsByOthers = Number(value) || 0;
                break;
        }
    }

    flush();
    return blocks;
}
