/**
 * Connected-source surfaces — design/02 §A2, §A2b, §J1.
 *
 * All presentational; every one of them takes its copy from
 * `@/lib/capture/consent` and its view models from `@/lib/capture/views`, so
 * the strings a user consents to live in one place and are testable without a
 * renderer.
 */

export { ConnectGithubPanel, type ConnectGithubPanelProps } from './connect-github-panel';
export { DisconnectDialog, type DisconnectDialogProps } from './disconnect-dialog';
export { RepoPicker, type RepoPickerProps } from './repo-picker';
export { SourceCard, type SourceCardProps } from './source-card';
export {
    SourcesScreen,
    type SourcesScreenActions,
    type SourcesScreenProps,
} from './sources-screen';
