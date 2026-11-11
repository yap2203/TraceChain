import { z } from 'zod';

/** Accept explicit calendar/ISO dates, never booleans, null or numeric coercions. */
export const requestDateSchema = z
  .union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));
