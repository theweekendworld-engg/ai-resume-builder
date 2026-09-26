// Side-effect imports: each channel registers its Scout notifier with
// `registerScoutNotifier` when loaded. `src/lib/scout/notify.ts` imports this
// file lazily so step bundles only pull channel code when a run notifies.
import '@/lib/channels/telegramScout';
import '@/lib/channels/whatsappScout';

export {};
