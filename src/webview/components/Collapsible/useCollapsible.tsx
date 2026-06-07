import { useState } from 'preact/hooks';
import './useCollapsible.less';

// Shared collapse primitive, mirroring the ▸/▾ chevron used by AskUserQuestion's
// resolved cards. `initialDisplayed` follows the user's mental model:
//   true  = displayed / open / expanded   (default)
//   false = collapsed / closed
//
// Returns the live `displayed` state, a `toggle`, and a ready-made <Chevron/>
// element that points ▾ when open and ▸ when collapsed. Each card decides where
// to place the chevron and what to hide when `displayed` is false.
export function useCollapsible(initialDisplayed: boolean = true) {
  const [displayed, setDisplayed] = useState(initialDisplayed);
  const toggle = () => setDisplayed((d) => !d);
  const chevron = (
    <span class="collapsible-chevron" aria-hidden="true">
      {displayed ? '▾' : '▸'}
    </span>
  );
  return { displayed, toggle, chevron };
}
