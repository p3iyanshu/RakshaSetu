import PerceptionScene from "../components/live/PerceptionScene.jsx";

/** Route-level wrapper, matching the CarView/AdminView pattern -- the
 * actual scene lives in components/live/PerceptionScene.jsx. */
export default function LiveView() {
  return <PerceptionScene />;
}
