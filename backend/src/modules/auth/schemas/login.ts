import { z } from "zod";

export const loginSchema = z
  .object({ email: z.string().email(), password: z.string().min(1) })
  .meta({ id: "LoginRequest" });

export type LoginBody = z.infer<typeof loginSchema>;
