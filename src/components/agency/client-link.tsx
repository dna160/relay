/**
 * The client access link, as a handoff rather than as a fact on a page.
 *
 * This is the most consequential control in the product: it is the entire way a
 * client gets into a workspace at all, and PRD §8 makes "client time-to-first-
 * action after invite" a headline metric — every second between an agency
 * wanting to hand the link over and managing to do it is spent on that metric.
 * What shipped before this was `/e/{token}` rendered as raw text: a relative
 * path, so pasting it anywhere produced a dead link, and an opaque signature the
 * agency had to select by hand. The owner's words were "I don't know what the
 * string of words means".
 *
 * **No behaviour lives here.** The take-this-value behaviour — one-action copy,
 * a confirmation shown where the action was taken, the mask, and the fallback
 * for a browser that refuses the clipboard — is `CopyField`, the primitive UI/UX
 * shipped for exactly this class of value. This file is the product half: which
 * value, what it is called, and who it is for.
 *
 * Three decisions that are this component's and not the primitive's:
 *
 * 1. **The value is absolute.** Composed by the page from the same `appUrl()`
 *    that `clientWorkspaceUrl()` uses for the invite email, so the link an
 *    agency copies is byte-identical to the one their client was emailed. Two
 *    spellings of the same link is how a support thread starts.
 *
 * 2. **`secret`.** `engagementToken()` is `{engagementId}.{hmac}`, and holding
 *    it is enough to request a sign-in code for this engagement — it is a
 *    credential, not an identifier. Not masked to keep it from the person on the
 *    page, who is entitled to it, but because this page is read in screen shares
 *    and over shoulders, and a value that is only ever *needed* on the clipboard
 *    has no reason to be permanently painted on a screen. The primitive's rule
 *    that copy works while masked is what makes this free: masking costs the
 *    common path nothing, so it is not a trade.
 *
 * 3. **The credential sentence sits after the control, not before it.** Someone
 *    here to send a link should not have to read a warning to find the button.
 *    Someone deciding where to paste it will read on.
 */

import { CopyField } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';

export function ClientLink({ url }: { url: string }) {
  return (
    <div className="flex flex-col gap-2">
      <CopyField
        label="The link that lets a client in"
        value={url}
        secret
        copyLabel="Copy link"
        copiedLabel="Copied. Paste it into an email or a message to your client."
        hint="Send it to anyone you have invited on this engagement. They open it, verify their email, and they are in — no account to create, no password to remember. It opens this engagement and no other."
      />
      <p className={cn('text-12 leading-4', muted)}>
        Treat it like a password. Anyone holding this link can ask for a sign-in code for this
        engagement, so send it to a person rather than posting it in a shared channel.
      </p>
    </div>
  );
}
