# Verification and remaining qualification

## Observed local instrument behavior

On 2026-10-27 the maintained browser entry point passed ten consumer journeys in sandboxed Chrome, using normal autoplay policy and actual Web Audio playing/stopped states. The received output included the full 573-note MIDI score, a 26-note relationship preview with downstream propagation, preservation of the pinned note and unrelated sections, atomic rejection of an invalid inversion, individual leaf-note acceptance and release, editable-project reopening, three 180-second stereo stems, a four-note MIDI import with exact provenance hash, and source-note insertion/edit propagation.

The browser recorded zero uncaught exceptions, external HTTP requests, or model-program requests. Desktop and mobile screenshots were captured and inspected; a motif-graphic overlap found in the initial desktop capture was repaired before the second course. See [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png), and the [occurrence editor](screenshots/desktop-editor.png).

An independent Mido 1.3.3 receiver matched all 573 audible note tuples, programs, and the complete 180-second timeline. Separate adversarial MIDI fixtures cover running status across meta events, malformed/truncated events, and supported format boundaries. The browser's own receiving parser is part of this project; the Mido comparison supplies a distinct implementation.

## Compiler and custody

Independent source cases exercise relationship semantics, occurrence dependency order, pins, selected-note acceptance, stale proposals, and rejection without mutation. The original three-minute demo has 108 occurrences and six relationships, including an answer-to-shadow dependency.

A retained ancestry-work counterexample has 257 notes and 33,794 final ancestry entries. Before the shared-work bound it compiled in 6,559.7 ms. The revised compiler rejects this excessive workload before completing it; the focused rejection case took 410.5 ms. This is bounded rejection, not an equivalent-result speedup. The original source, fixture, and observation remain in local recovery artifacts.

Audio preflight cases verify rejection before oversized PCM/stem allocations and verify shared-origin stem summation. Project-file checks verify checksum binding, fresh compilation on reopen, lock/override preservation, and rejection of unsafe object structures. Imported model evidence remains informational and cannot acquire trusted origin by being resaved.

## Model-path evidence

Sixteen server/provider cases and nine project-file cases passed together: 25 tests, zero failures or skips, 799.84 ms. Every provider response was injected test data; no live upstream request was made. Cases cover disabled-by-default behavior, static-file boundaries, valid typed programs, one compiler-guided repair, repair caps, unknown transport outcomes, stale revisions, request bounds, origin/Host enforcement, timeout cancellation, single-flight behavior, separate attempt receipts, and preservation of confirmed receipts across later failure or timeout.

The musical-language fixtures are explicit semitone instructions. A passing injected response does not establish natural-language interpretation by a model.

## Unfinished outcome qualification

- Live account/model availability, actual NVIDIA generation on Nebius, complete token/cost receipts, and useful held-out composition results remain unqualified.
- No subjective listening assessment or blinded musical-quality finding is claimed. Valid PCM, MIDI, and visible playback are separate evidence.
- No reduction in human composer effort or advantage over independent clip editing has been measured. Edit counts are not human-time measurements.
- Exact-head archive receiving is performed after source checkpointing; use its manifest and receiving receipt rather than inferring delivery from this document.

Original inputs are authored fixtures. Imported user material, credentials, large audio downloads, and browser profiles are excluded from the source package.

## Frozen musical request fixtures

The independent oracle in `evaluation/heldout-v1.mjs` defines three future model tasks against separate copies of the original revision0 demo: raise Glass answers by a minor third with downstream shadow propagation; align and soften Ground shadows; relocate the Ember interruption to the first Glass onset. Gold programs, expected notes, and flat clip-edit plans are excluded from model input. The four oracle tests validate authored reference cases only, with no model calls. Structural clip/note/field counts are 6/26/26, 3/12/24, and 3/6/6; they do not measure human effort.

The complete initial local suite passed 58/58 tests (903.68 ms), followed by the four independent held-out oracle tests passing 4/4 (368.24 ms). All 62 cases were executed; live inference remained disabled.
