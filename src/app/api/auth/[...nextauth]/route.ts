/** Auth.js v5 catch-all. Agency sign-in only; client links are handled by the
 *  static `auth/client/*` routes, which take precedence over this segment. */

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
