import { FiveMFramework } from '@prisma/client';
import type { FrameworkAdapter } from './types';
import { EsxAdapter } from './esx';
import { QbCoreAdapter } from './qbcore';
import { CustomAdapter } from './custom';

export * from './types';
export { AdapterError, fetchJson, normalizeHost } from './base';
export { EsxAdapter, QbCoreAdapter, CustomAdapter };

const ADAPTERS: Record<FiveMFramework, FrameworkAdapter> = {
  [FiveMFramework.ESX]: new EsxAdapter(),
  [FiveMFramework.QBCORE]: new QbCoreAdapter(),
  [FiveMFramework.CUSTOM]: new CustomAdapter(),
};

export function getAdapter(framework: FiveMFramework | string | null | undefined): FrameworkAdapter {
  return ADAPTERS[(framework ?? FiveMFramework.CUSTOM) as FiveMFramework] ?? ADAPTERS[FiveMFramework.CUSTOM];
}
