import { storage } from '#imports';

export type BlockStatus = 'blocked' | 'unblocked' | 'unknown';

export interface Detection {
  status: BlockStatus;
  reason: string;
  checkedAt: number;
}

export interface Settings {
  /** Master switch. */
  enabled: boolean;
  /** Proxy even when no block is detected. */
  alwaysProxy: boolean;
  /** Only use rimgo instances that say they don't collect data. */
  onlyNoDataInstances: boolean;
  /** User's own rimgo instance, tried after the healthy public ones. Empty when unset. */
  customInstance: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  alwaysProxy: false,
  onlyNoDataInstances: false,
  customInstance: '',
};

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export const detectionItem = storage.defineItem<Detection>('local:detection', {
  fallback: { status: 'unknown', reason: 'not checked yet', checkedAt: 0 },
});

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export function isActive(settings: Settings, detection: Detection): boolean {
  return settings.enabled && (settings.alwaysProxy || detection.status === 'blocked');
}
