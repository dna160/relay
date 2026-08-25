# The label system

> Owned by the design layer. Implementation: `src/app/globals.css` §7
> (`.dieline`, `.colour-bar`, `.plate`, `.hazard-rule`, `.reg-mark`) and the
> `Plate`, `Barcode`, `RegistrationMark` primitives plus `Rule weight="hazard"`.
> Motion is a separate document: `docs/design/MOTION.md`.

## 1. Why this is not a theme

The direction came from industrial spec-label sheets: barcodes, batch and
serial plates, compliance marks, hazard stripes, dielines, tiny dense mono data
tables, blueprint linework. The reaction to those sheets was *"I like this
design"*, and the correct response is not to apply them as a skin.

`docs/DESIGN-SYSTEM.md` already says, in its first paragraph, that the subject
is **production paperwork: call sheets, dockets, delivery notes** — a Relay
workspace is a temporary, dated, high-information document that two parties
read together and then throw away. And it already says that **monospace marks
everything that is a record**: v4, the sha256 prefix, `14d to purge`, the
decision timestamp.

An industrial spec label is exactly that vernacular at higher density. It is a
temporary, dated, high-information document attached to a physical thing,
carrying the numbers that would be cited if something went wrong. Relay's cards
*are* labels: they are attached to a deliverable, they carry its serial and its
version and its custody, and they are thrown away when the job wraps.

So this round is not a pivot. It is the system's own world, sharpened — and the
test for every decision below is: **does the product already contain the thing
this draws?** Where the answer is yes it ships. Where the answer is no, it was
rejected, and §6 lists what was rejected and why. The rejections are the more
useful half of this document.

## 2. The constraint that shapes everything

**Colour encodes possession, not urgency.**

The reference sheets use alert red constantly — hazard bands, warning
stickers, danger plates — and they use signal yellow, lilac and cyan/magenta
registration families beside it. Relay cannot follow that, and this is the one
place the direction had to be reconciled rather than obeyed.

`--breach` red means exactly one thing: `roundsUsed > contractedRounds`. That
reservation is only worth something if it is absolute. A second red on a hazard
stripe, or a signal yellow that means "attention", would spend a channel the
product needs for its single most consequential fact and would leave a reader
unable to tell a breach from a decoration.

**So the reconciliation is this: take the label's structure and density, not
its promiscuous colour.** In practice:

- **No new hue token ships in this round.** The entire label system is drawn in
  `--ink`, `--paper`, `--paper-2`, `--rule` and `--rule-strong`. Every contrast
  pair it uses is already in `src/styles/a11y-contract.ts`; not one new pair
  was needed, and that is by construction rather than by luck.
- **The white-label OKLCH clamp is untouched.** A tenant still sets exactly one
  property, `--brand-agency`, and it still passes through the clamp. Nothing in
  the label system reads it or routes round it.
- Density comes from **rules, plates, mono, and stripes** — all achromatic.

And there is a better argument available than "we cannot have the colour",
which is that **Relay is already doing what those sheets do.** Look at them
again: each individual sheet is black and white plus *one* spot colour, and
that spot colour is the label's identity. Relay's rule is identical — each card
is black and white plus one spot colour, and that colour is who holds the work.
The reference sheets' own logic is the possession bar. We did not have to
borrow their palette because we already had their method.

## 3. What ships

### 3a. The card as a physical label — **adopted**

Three changes, in order of how much they carry.

**The dieline.** A printed label has a trimmed edge and, inset from it, the cut
line the die follows. Relay's card already has the trimmed edge: the
`--rule-strong` hairline that WCAG 1.4.11 requires of anything operable. The
`.dieline` class adds the cut line — a dashed `--rule` hairline 2px inside it,
drawn as a single `::before`.

This is the highest-value change in the whole round for the least cost. One
pseudo-element per card turns a rectangle into an object that was *cut out of
something*, which is the entire perceptual difference between a UI card and a
label. `--rule` is decorative and this is decoration; the operable boundary is
still the solid outer hairline, so nothing about 1.4.11 moves.

**The batch/serial plate.** The `Plate` primitive: a dense mono `<dl>` on a
recessed ground, carrying the values that are already records — card id,
version, sha prefix, size, rounds, dates. Nothing here is new information. The
plate is a *layout for facts the product already publishes one at a time*, set
at the density the reference sheets have and in the place a reader looks for a
serial number.

Its ground is `--paper`, deliberately: on a card (`--paper-2`) it reads one step
recessed in both light and dark, and it is a ground the contrast table already
covers for every text token. A bespoke mix would have been a new contrast pair
nobody measured — the exact failure mode that let the old `--muted` ship at
4.14:1.

**The possession bar as a printed colour bar.** `.colour-bar` adds one knockout
notch 5px from the head of the bar, the way a press control strip divides its
segments. It composes with the existing `bg-agency` / `bg-client` fill, so the
bar's colour API does not move at all.

This is a small mark and it is doing real work: it is what makes the bar read
as *ink laid down on the card* rather than as a border. That reading is what
the label-attach animation then dramatises — the bar is drawn top to bottom in
the new hue, a second pass of ink over the first, rather than crossfading. The
static treatment and the motion are the same idea; neither would land alone.

### 3b. Barcodes that encode — **adopted, narrowly**

**The principle is accepted without qualification.** The design system's own
rule is that mono marks a record. A barcode that encodes nothing is decoration
wearing a record's clothes — it borrows the authority of a machine-readable
mark while being a texture, on a document whose entire value is that its
numbers can be cited. Relay does not get to print one of those.

So `Barcode` encodes. Point a scanner at the bars on a purge certificate and
you get back exactly the sha256 prefix printed beneath them.

**Code 39, not a QR.** Four reasons, in order of weight:

1. Code 39 is self-checking and needs no checksum, so the encoder is a lookup
   table and 40 lines. A QR needs Reed–Solomon error correction — a real
   algorithm, or a dependency, and this round permits neither.
2. A hex sha prefix is entirely inside the Code 39 alphabet.
3. A QR scanned by a phone yields a bare hex string with nothing to do about
   it. The only value in this product worth making phone-scannable is the
   client link, and that is a security surface the design layer does not own
   and should not be quietly minting a second channel to.
4. A 2D block fights a rule system. A bar field sits inside one.

**Where it is allowed, and where it is not.** Surfaces that carry exactly one
and are not the board: the purge certificate, the export header, a version's
detail record. **Not the card.** The bars are one `<path>` rather than one node
per bar, but an 8-character prefix is still ~50 subpaths, and that is cheap
once per document and indefensible forty times on the surface with a 1.5s FCP
budget. `CardTile` gets a `Plate`, which is text.

**Polarity is part of the encoding, so the barcode does not follow the theme.**
The bars are `--barcode-bar` on a `--barcode-substrate` plate — black on white,
in light, in dark and in print — and the plate covers the quiet zone as well as
the bars.

This is the same argument as the one above, one step later. A barcode that
encodes nothing is decoration wearing a record's clothes. A barcode that
encodes correctly and *cannot be scanned* is the same failure with the evidence
hidden: it looks like a machine-readable mark, it passes every review, and the
one time it matters a reader points a scanner at it and gets nothing. Round 3
filled the bars with `currentColor`, which in dark mode is light bars on a dark
ground, and an inverted Code 39 is — to most laser and CCD readers and to
plenty of camera decoders — not a symbol at all. On the purge certificate.

Bar/space polarity and the quiet zone are properties of the symbology, not
choices the palette gets to make, and treating them as styling was the mistake.
The right reading of a barcode that stays black-on-white in dark mode is not
"an element that ignores the theme" but "a printed label stuck to the page",
which is exactly what it is. The human-readable line beneath the bars is *not*
part of the plate: it is text, it is `--ink` on the page ground, and it follows
the theme like every other record in the product.

Both tokens are declared `!important` in `globals.css` §5 for the same reason
the palette literals are — they are literals rather than `var()`s of a locked
token, so they do not inherit the white-label protection, and a tenant must not
be able to invert a machine-readable mark.

The bars are `aria-hidden`; the human-readable value beneath them in `Mono` is
the accessible content. They are a second, machine-facing rendering of text
that is already on the page, and a reader who heard both would hear the same
hash twice. This is also how real spec labels do it — the human-readable line
under the bars is not a convention, it is the fallback.

### 3c. The purge certificate as a certificate of destruction — **adopted, and this is the point of the round**

This document is forwarded to a client's legal team. Everything above is
sharpening; this is the one place where the label vernacular is not a stylistic
choice but the correct genre. A certificate of destruction is a real document
type, and Relay produces a real one: the bytes are gone, and this is the proof.

The treatment, in order down the page:

| Element | Drawn with |
|---|---|
| Registration mark + issuing plate | `RegistrationMark`, `Plate layout="strip"` — "issued by Relay, at this moment" |
| Title, `CERTIFICATE OF DESTRUCTION` | `font-display`, uppercase, `text-lane` treatment scaled up |
| Hazard boundary | `Rule weight="hazard"` — the line, and the far side of it |
| The record | `Plate layout="stack" dieline` — engagement, org, wrap date, purge date, object count, bytes, manifest digest |
| Manifest digest | `Barcode` — encoding the digest printed beneath it |
| Attestation line | body copy, stating what was destroyed and that the record is what remains |

**Nothing on it animates, in either motion mode.** That is an entry in the
motion restraint list: a record does not perform. A certificate that faded in
would be a certificate someone would be right to distrust.

**No CE, FCC, UL or WEEE marks — see §6.** The compliance-plate *treatment* is
adopted; the compliance *marks* are not, and the distinction is not pedantry.

### 3d. Hazard stripes — **adopted for exactly one referent**

`Rule weight="hazard"`: a 6px band of `--ink` diagonals at −45°, achromatic.

One referent in this product: **the purge boundary.** The head of the purge
certificate, and the boundary of the countdown zone in the wrap slate.

Why this is not urgency creep, which is the obvious objection. Purge is not an
alarm — the design system's rule is that ephemerality is *stated, never
sprung*, and the wrap slate is never dismissible for exactly that reason. But a
purge date is a genuine boundary with a genuine far side: after it, the bytes
do not exist. A hazard stripe is a boundary marker before it is a danger
signal, and drawn in black and white it carries "there is a line here" without
carrying "panic". The stripes never appear without text beside them saying what
the boundary is; they are never the only channel.

### 3e. Registration marks — **adopted, one per document**

`.reg-mark` / `RegistrationMark`: a printer's crosshair, drawn entirely in
background gradients on one element. On a press sheet it is where the plates
line up; on a Relay document it marks the point at which the document was
*issued*. The head of the wrap slate, the head of a certificate, the header of
an export.

It is the only circle in a product whose radius ceiling is 3px. That ceiling
exists so surfaces do not read as a SaaS dashboard; a registration mark is a
printer's mark and is a circle by definition. The exception is named here and
in the primitive so nobody has to guess whether it was an oversight.

## 4. Density

The reference sheets are *dense* — that is most of what makes them feel
technical, more than any individual mark. Relay's density levers, all already
in the system:

- **`text-eyebrow`** (12px, uppercase, +0.08em, display 600) for plate terms.
  Already the badge and section-eyebrow treatment; a plate is a section of
  eyebrows and values.
- **Martian Mono at `wdth` 87.5 with `tracking-mono`**, which is what lets
  `v4 · 12.4 MB · 3a91f2…` fit inside a 280px card. The plate leans on this
  harder than anything else does.
- **Hairlines, not gaps.** `Plate layout="strip"` divides with `--rule`, not
  with whitespace. Rules read as information structure; whitespace reads as
  layout.
- **Tabular figures**, already pinned on `.font-mono`. A plate whose digits
  shift width is a plate you cannot scan down.

Nothing new was needed for density. It was all in the type appendix already.

## 5. Where each piece goes

| Surface | Gets | Does not get |
|---|---|---|
| `CardTile` | `.dieline`, `.colour-bar` on the possession bar, `Plate layout="stack"` for id / version / sha / rounds | `Barcode` (cost — §3b), hazard stripes |
| `LaneColumn` | nothing new; the `PRIVATE` badge is already a stamp | — |
| `VersionStack` | `Plate layout="strip"` per row; `Barcode` on an expanded row only | a barcode per row |
| `WrapSlate` | `RegistrationMark` at the head, `Plate layout="strip"` for the countdown, `Rule weight="hazard"` under the purge zone | possession colour — the slate is neutral |
| Purge certificate | all of it (§3c) | any motion, in either mode |
| Export header | `RegistrationMark`, `Plate layout="strip"`, `Barcode` of the manifest digest | — |
| The shelf | `Plate layout="strip"` per row | dielines — a shelf row is a row, not a label |
| Client board | `.dieline` and `.colour-bar` only | plates below the fold, barcodes, anything that costs FCP |

## 6. Rejected, and why

**Compliance marks — CE, FCC, UL, WEEE, ISO 9001.** Rejected outright, and this
is the firmest rejection in the document. These are real regulatory marks owned
by real bodies with real legal meaning. Printing a CE mark on a document that
goes to a client's legal team is a false compliance claim, and printing one on
a card is a false claim in a friendlier font. The *treatment* — a bounded plate
bearing an issuing authority and a code — is exactly right and is adopted in
§3c. The marks themselves are somebody else's. The honest equivalent is a
Relay-owned plate: `RELAY · SYS`, the manifest digest, the issuing timestamp.
That is a claim we can actually make.

**Alert red anywhere.** §2. The single most important rejection: `--breach` is
reserved for `roundsUsed > contractedRounds` and a reservation that bends once
is not a reservation.

**Signal yellow, lilac, kraft/tan, cyan-magenta registration.** Rejected as
palette. Each would add a semantic channel that means nothing, on a product
whose central design risk is that hue means possession and only possession. The
kraft/tan family is also already answered: `--paper` is a cool oat, and
DESIGN-SYSTEM.md specifies "not cream" for a reason — warm paper plus a green
and an indigo is a muddier three-way relationship than cool paper gives.

**Halftone dot ramps.** Rejected. They are a print artefact for reproducing
continuous tone, and Relay has no continuous tone — nothing in this product is
a gradient of anything. One use was seriously considered and dropped: a faint
ramp on a card in its last days before purge, as an "ageing out" texture. It
was rejected for two reasons. It would be an urgency channel that is not a hue
but works like one, and it would be per-card paint on the surface with the FCP
budget. The countdown states a date; that is the product's answer to that
question and it is a better one.

**Blueprint wireframe globes.** Rejected. Pure ornament with no referent. There
is nothing spherical, global or schematic in a Relay workspace, and drawing one
would be the exact "bolt a theme on" failure this round was told to avoid.

**Warning stickers / "DO NOT REMOVE" plates.** Rejected. They are hazard
stripes' voice without hazard stripes' one legitimate referent. The one thing
in Relay that must not be removed — the wrap slate — is already
non-dismissible, and stating that in a sticker would be decoration about a
property the interface already has.

**A barcode on every card.** Rejected on cost, not on principle. §3b.

**A QR code anywhere.** Rejected. §3b, reasons 1 and 3 in particular.

**Perforation edges, tear strips, adhesive-corner shading.** Rejected. They
imply a physical affordance the interface does not have. A dieline says "this
was cut"; a tear strip says "you can tear this", and you cannot.

## 7. Accessibility, restated for this round

Nothing in this document moves the floor, and that was a design constraint
rather than an outcome:

- **No new colour token, therefore no new contrast pair.** Every ground the
  label system uses (`--paper`, `--paper-2`) and every foreground (`--ink`,
  `--muted`, `--rule`, `--rule-strong`) is already in `CONTRAST_PAIRS`.
- **The dieline is decorative** and is drawn in `--rule` (1.40:1), which is
  correct precisely because it is decoration. The operable boundary remains the
  `--rule-strong` hairline at 3.005:1.
- **The hazard band is decorative** and `aria-hidden`, and never appears
  without text stating the boundary.
- **The registration mark is `aria-hidden`** unless given an explicit label,
  which it should not need.
- **The barcode is `aria-hidden`**; the value is on the page in `Mono`.
- **Plates are `<dl>`** with a `aria-label`, so a screen reader gets terms and
  values rather than a run of numbers.
- **Print.** `print-color-adjust: exact` is set on the hazard band, the
  registration mark and the colour bar, because browsers drop background images
  in print by default and that would silently delete the two marks that say a
  certificate of destruction is an issued record.
