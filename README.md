# Krillion Helper

A Chrome extension for [Krillion](https://krillion.org), the trivia game where rarer correct answers score more. It reads the prompt on screen and asks Claude for answers that fit but that other players are unlikely to give.

## Features

- **On-page panel.** A small panel in the corner of the game shows answers for each new prompt as soon as it appears, streaming in one at a time. No need to open the popup.
- **Click to fill.** Clicking an answer puts it in the game's answer box, ready to send with Enter. If there's no box at that moment, the answer is copied instead.
- **New answers.** The ↻ button asks for a fresh set and skips everything already shown for that prompt.
- **Puffer Party mode.** In Krillion's multiplayer mode, the extension records every answer other players get accepted, per question, and never suggests those. The used answers are listed, crossed out, at the bottom of the panel.
- **Popup.** A backup that reads the prompt from the page, or takes one you type in.

Works on krillion.org, krillion.io and krillion.lol, including when the game runs inside an iframe.

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `krillion-helper` folder.

## Set up your API key

The extension calls the Claude API, so it needs an Anthropic API key from [console.anthropic.com](https://console.anthropic.com). Use either option:

- **Settings:** open the popup, click **Settings**, paste the key and save. It's stored only in your browser.
- **`.env` file:** create a `.env` file in the extension folder:

  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```

  `.env` is in `.gitignore`, so it won't be committed. Reload the extension after changing it. A key saved in Settings takes priority over `.env`.

Settings also lets you pick the model: Claude Opus 5.5 (default, most accurate), Sonnet 5.5, or Haiku 5.5 (fastest and cheapest). Each prompt costs a fraction of a cent.

## Usage

1. Open a Krillion game and start a round.
2. The panel appears with answers. Click one to fill it in, then press Enter.
3. Click **↻** for different answers, or the title bar to collapse the panel.

For Puffer Party, tick **Puffer Party mode** in the popup before playing. The panel's title shows "· Party" while it's on.

## How it works

| File | Role |
| --- | --- |
| `manifest.json` | Extension config (Manifest V3) |
| `content.js` | Runs on the game page: finds the prompt, shows the panel, fills the answer box, tracks used answers in Puffer Party |
| `background.js` | Service worker that calls the Claude API with streaming and structured output, so only answers come back. Keeps the API key out of the game page |
| `ai.js` | Shared helper that streams answers from the background worker |
| `popup.html`, `popup.js` | Toolbar popup and the Puffer Party toggle |
| `options.html`, `options.js` | Settings page for the API key and model |
| `style.css` | Popup and Settings styles |

## Limitations

- The prompt and answer box are found by the game's current page structure. If Krillion changes its layout, detection may need updating.
- Claude can still give a wrong or common answer now and then.
- Puffer Party used answers are read from players' speech bubbles. One that disappears before the extension sees it won't be recorded.

## Fair play

Krillion scores depend on what other players answer, and Puffer Party is played against real people. Using this in daily or multiplayer games gives you an edge others don't have, and may break the game's rules.
