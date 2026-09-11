import { z } from "zod";

/** Safe profile only — never the password hash or the session token. */
export const authenticatedUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    desk: z.string()
  })
  .meta({ id: "AuthenticatedUser" });

export const currentUserResponseSchema = z
  .object({ user: authenticatedUserSchema })
  .meta({ id: "CurrentUserResponse" });
