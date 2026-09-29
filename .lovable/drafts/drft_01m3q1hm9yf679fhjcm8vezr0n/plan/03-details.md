## What changes

1. **Shared workspace:** Tighten the left rail, give active navigation a restrained champagne highlight, and align page headers and actions in a quiet top band. Keep the version at the rail’s foot and preserve access to New event and Check for updates. On smaller screens, keep navigation reachable without covering content.
2. **Home and Events:** Replace oversized presentation spacing with scannable summary figures and recent/saved event rows. Preserve actual data and honest unavailable states; do not invent DJ plays, guest requests, or a global search that has no working destination.
3. **Library:** Give the searchable track list visual priority: compact rows, clear column headers, aligned metadata, accessible play/edit controls, and the existing column chooser. Keep folder-management actions visible and show only paths the browser actually supplies.
4. **Event builder and review:** Keep the current step order and one-list-at-a-time review. Make export actions, list tabs, match totals, filters, and matcher actions compact and orderly; render each song’s source and metrics in a legible row and its checkbox-selectable local matches immediately beneath it. Keep page scrolling natural and narrow-screen rows legible.
5. **Playback and Settings:** Style the existing real-file waveform as a restrained bottom transport strip with visible playback state and time; preserve the reconnect message. Group current matcher, DJ software, folder, profile, and password controls with the same hierarchy—without adding unsupported integrations or settings.

## Technical details and boundaries

- Define the selected palette through semantic tokens and load Sora/Manrope through the root page head. Keep a working light theme. Replace decorative background effects and serif-heavy headings in the authenticated workspace.
- Apply the layout within the existing authenticated shell and existing Home, Events, Library, Settings, Updates, and `/events/new` screens. Use current button/form components; do not introduce placeholder actions from the prototype, such as Loop, Cue, Sync, fake compatibility scores, or sample tracks.
- Leave song selection, AI recommendations, matching decisions, autosave, exports, account storage, and backend untouched. Change presentation and only minimal UI state needed for the arrangement.
- Verify desktop and mobile navigation, event review, inline multi-selection, library playback, and the bottom player against the running preview; check that controls do not overlap and preview errors are absent.