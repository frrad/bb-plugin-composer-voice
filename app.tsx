import {
  definePluginApp,
  experimental_useComposerRenderer as useComposerRenderer,
} from "@get-bb/plugin-sdk/app";
import { PromptBoxInternal } from "./src/PromptBoxInternal";
import { runVoiceInputCommand } from "./src/voice-input-command";
import "./src/composer.css";

function Composer() {
  const { input } = useComposerRenderer();
  return <PromptBoxInternal {...input} />;
}

export default definePluginApp((app) => {
  app.composer.experimental_registerCommand({
    id: "start-voice-input",
    title: "Toggle voice input",
    defaultShortcut: { key: "d", mod: true },
    run: ({ composer }) => runVoiceInputCommand(composer.key),
  });
  app.slots.experimental_composer({
    id: "composer",
    title: "Composer (voice shortcut)",
    description:
      "bb's composer with a rebindable voice-input shortcut: Mod+D toggles recording, Enter while recording transcribes and sends.",
    component: Composer,
  });
});
