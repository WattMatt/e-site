import phasing from './mv-phasing-test-record.json';
import megger from './mv-megger-insulation-test.json';
import cable from './mv-cable-test-certificate.json';
import protection from './mv-protection-settings-summary.json';
import annexB from './mv-safety-report-annex-b.json';
import type { Template } from '../types';

export const MV_TEMPLATES = [
  phasing,
  megger,
  cable,
  protection,
  annexB,
] as unknown as Template[];
