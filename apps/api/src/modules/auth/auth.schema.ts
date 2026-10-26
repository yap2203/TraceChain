import { isAddress } from 'ethers';
import { z } from 'zod';

export const walletAddressSchema = z
  .string()
  .trim()
  .refine((address) => isAddress(address), 'A valid Ethereum wallet address is required.');

export const nonceRequestSchema = z
  .object({
    address: walletAddressSchema,
  })
  .strict();

export const verifyRequestSchema = z
  .object({
    message: z.string().min(1).max(4_096),
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/)
      .max(4_096),
  })
  .strict();
