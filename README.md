# Obsidian Sidenotes Plugin

This plugin for Obsidian (https://obsidian.md) allows you to display footnotes as sidenotes in the margins of your notes. For now it is desktop only, as I haven't tested it on mobile yet.

## Features

- Converts footnotes to sidenotes displayed in the margin
- Dynamic layout adjusts based on screen size
- Customizable settings for sidenote positioning and behavior
- Supports both left and right margin positioning
- Inline mode for narrow screens with grouping options

## Known issues

- There are some issues related to the positioning of the sidenotes when they are supposed to be rendered on the left margin. Specifically, if the footnote is referenced in indented text the sidenote will also be indented.

## Installation

1. Open Obsidian and go to Settings > Community Plugins
2. Disable Safe Mode
3. Click "Browse" and search for "Sidenotes"
4. Install the plugin and enable it

## Usage

Once enabled, the plugin will automatically convert footnotes in your notes to sidenotes. You can customize the behavior in the plugin settings.

## Settings

- **Enable sidenotes**: Toggle sidenotes visibility
- **Sidenotes position**: Choose which side to display sidenotes (left or right)
- **Dynamic sidenotes**: Adjust sidenotes layout based on screen size
- **Group inline sidenotes**: Group sidenotes by paragraph when inline
- **Inline breakpoint**: Screen width at which sidenotes become inline
- **Sidenotes comfort zone**: Minimum width for sidenotes before switching to inline mode

## Development

This plugin is developed using TypeScript and the Obsidian API.

### First time setup

1. Clone this repository to your local machine
2. Make sure you have NodeJS installed (v16 or newer)
3. Run `npm install` in the project folder to install dependencies
4. Run `npm run dev` to start the compilation in watch mode

### Building the plugin

- `npm run build` compiles the plugin into `main.js`
- `npm run dev` compiles and watches for changes, useful during development

### Manual installation for development

1. Copy `main.js`, `styles.css`, and `manifest.json` to your vault's `.obsidian/plugins/sidenotes-plugin/` directory
2. Reload Obsidian to load the new version of your plugin
3. Enable the plugin in Obsidian's settings

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)

## Support

If you find this plugin helpful, you can support its development by:

- Donating to charity or supporting obsidian.md directly.

## Acknowledgements

This plugin was inspired by the sidenotes feature in many academic and literary works, aiming to bring that experience to Obsidian users.