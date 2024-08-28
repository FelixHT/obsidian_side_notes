import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, MarkdownView, MarkdownPostProcessorContext } from 'obsidian';
import { EditorView, ViewUpdate, PluginValue, ViewPlugin, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { EditorState, Range as CodeMirrorRange } from "@codemirror/state";

interface SidenotesPluginSettings {
  sidenotesEnabled: boolean;
  sidenotesPosition: 'right' | 'left';
  sidenotesWidth: number;
  sidenotesColor: string;
  autoConvertFootnotes: boolean;
  showSidenotesInPreviewMode: boolean;
  showSidenotesInEditMode: boolean;
  numberingStyle: 'none' | 'numeric' | 'alphabetic-lower' | 'alphabetic-upper';
  numberingPosition: 'superscript' | 'inline';
  numberingColor: string;
  dynamicSidenotes: boolean;
  inlineSidenotesGrouping: boolean;
  inlineBreakpoint: number;
}

const DEFAULT_SETTINGS: SidenotesPluginSettings = {
  sidenotesEnabled: true,
  sidenotesPosition: 'right',
  sidenotesWidth: 30,
  sidenotesColor: '#666666',
  autoConvertFootnotes: false,
  showSidenotesInPreviewMode: true,
  showSidenotesInEditMode: true,
  numberingStyle: 'numeric',
  numberingPosition: 'superscript',
  numberingColor: '#999999',
  dynamicSidenotes: true,
  inlineSidenotesGrouping: true,
  inlineBreakpoint: 1100,
};

export default class SidenotesPlugin extends Plugin {
  settings: SidenotesPluginSettings;
  footnoteContents: Map<string, string>;
  private usedFootnotes: Map<string, string> = new Map();
  private currentIndex: number = 1;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'insert-sidenote',
      name: 'Insert sidenote',
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        editor.replaceRange('[^sidenote]', cursor);
        editor.setCursor(cursor.line, cursor.ch + 11);
      },
    });

    this.addCommand({
      id: 'toggle-sidenotes',
      name: 'Toggle sidenotes visibility',
      callback: () => {
        this.settings.sidenotesEnabled = !this.settings.sidenotesEnabled;
        this.saveSettings();
        this.refreshView();
      },
    });

    this.addCommand({
      id: 'toggle-footnotes',
      name: 'Toggle footnotes visibility',
      callback: () => {
        document.body.classList.toggle('hide-footnotes');
      },
    });

    this.addCommand({
      id: 'reset-sidenotes-settings',
      name: 'Reset Sidenotes settings to defaults',
      callback: async () => {
        await this.resetSettings();
        new Notice('Sidenotes settings have been reset to defaults');
      },
    });

    this.addSettingTab(new SidenotesSettingTab(this.app, this));

    this.registerEditorExtension([sidenotesPlugin]);
    this.registerMarkdownPostProcessor(this.postProcessor.bind(this));

    this.loadStyles();

    this.registerEvent(
      this.app.workspace.on('layout-change', this.handleLayoutChange.bind(this))
    );

    this.registerInterval(
      window.setInterval(() => this.refreshViewMode(), 5000)
    );

    this.registerDomEvent(window, 'resize', this.handleResize.bind(this));
  }

  onunload() {
    const styleEl = document.getElementById('sidenotes-styles');
    if (styleEl) styleEl.remove();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async resetSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    await this.saveSettings();
    this.refreshView();
  }

  loadStyles() {
    let styleEl = document.getElementById('sidenotes-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'sidenotes-styles';
      document.head.appendChild(styleEl);
    }
    
    const dynamicStyles = this.settings.dynamicSidenotes ? `
      @media (max-width: ${this.settings.inlineBreakpoint}px) {
        .markdown-preview-view .sidenote {
          float: none;
          display: block;
          margin: 1em 0;
          width: 100%;
          font-size: 0.9em;
          text-align: left;
        }
      }
    ` : '';

    const leftSideStyles = this.settings.sidenotesPosition === 'left' ? `
      .sidenote {
        float: left;
        clear: left;
        margin-left: -33%;
        margin-right: 0;
        text-align: right;
      }
      .sidenote-content {
        display: inline-block;
        text-align: right;
      }
    ` : '';

    const rightSideStyles = this.settings.sidenotesPosition === 'right' ? `
      .sidenote {
        float: right;
        clear: right;
        margin-right: -33%;
        margin-left: 0;
        text-align: left;
      }
      .sidenote-content {
        display: inline-block;
        text-align: left;
      }
    ` : '';

    styleEl.textContent = `
      .markdown-source-view.mod-cm6 .cm-content {
        position: relative;
      }
      .markdown-preview-view {
        position: relative;
      }
      .sidenote {
        width: 30%;
        font-size: 0.8em;
        line-height: 1.3;
        vertical-align: baseline;
        position: relative;
      }
      ${leftSideStyles}
      ${rightSideStyles}
      ${dynamicStyles}
      .grouped-sidenotes {
        margin-top: 1em;
        padding: 0.5em;
        border-left: 2px solid var(--text-muted);
        text-align: left;
      }
    `;
  }

  refreshView() {
    this.loadStyles();
    this.refreshViewMode();
  }

  renderSidenotes(el: HTMLElement) {
    el.querySelectorAll('.sidenote, .grouped-sidenotes').forEach(node => node.remove());

    if (this.footnoteContents) {
      const footnoteRefs = Array.from(el.querySelectorAll('sup[data-footnote-id]'));
      
      const isPreviewMode = el.closest('.markdown-preview-view') !== null;
      const shouldGroupInline = isPreviewMode && 
                                this.settings.dynamicSidenotes && 
                                this.settings.inlineSidenotesGrouping && 
                                window.innerWidth <= this.settings.inlineBreakpoint;
      
      if (shouldGroupInline) {
        const paragraphs = el.querySelectorAll('p');
        paragraphs.forEach(paragraph => {
          const refsInParagraph = footnoteRefs.filter(ref => paragraph.contains(ref));
          if (refsInParagraph.length > 0) {
            const groupedSidenotes = document.createElement('div');
            groupedSidenotes.className = 'grouped-sidenotes';
            refsInParagraph.forEach(ref => {
              const id = ref.getAttribute('data-footnote-id');
              if (id) {
                const cleanId = id.replace('fnref-', '').split('-')[0];
                const content = this.footnoteContents.get(cleanId);
                if (content) {
                  const sidenote = document.createElement('div');
                  sidenote.innerHTML = `<sup>${cleanId}</sup> ${content}`;
                  groupedSidenotes.appendChild(sidenote);
                }
              }
            });
            paragraph.insertAdjacentElement('afterend', groupedSidenotes);
          }
        });
      } else {
        footnoteRefs.forEach(ref => {
          const id = ref.getAttribute('data-footnote-id');
          if (id) {
            const cleanId = id.replace('fnref-', '').split('-')[0];
            const content = this.footnoteContents.get(cleanId);
            if (content) {
              const sidenote = document.createElement('span');
              sidenote.className = 'sidenote';
              const wrapper = document.createElement('span');
              wrapper.className = 'sidenote-content';
              wrapper.innerHTML = `<sup>${cleanId}</sup> ${content}`;
              sidenote.appendChild(wrapper);
              ref.insertAdjacentElement('afterend', sidenote);
            }
          }
        });
      }
    }
  }

  postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    if (ctx.frontmatter && ctx.frontmatter['position'] === undefined) {
      this.usedFootnotes.clear();
      this.currentIndex = 1;
    }

    const footnoteSection = el.querySelector('.footnotes');
    if (footnoteSection) {
      const footnoteContents = new Map();
      footnoteSection.querySelectorAll('li[id^="fn-"]').forEach((li) => {
        const id = li.id.replace('fn-', '').split('-')[0];
        const content = li.innerHTML
          .replace(/<a href="#fnref.*?<\/a>/g, '')
          .replace(/<\/?p>/g, '')
          .trim()
          .replace(/^\s+|\s+$/gm, '');
        footnoteContents.set(id, content);
      });
      this.footnoteContents = footnoteContents;
    }

    if (this.settings.showSidenotesInPreviewMode) {
      this.renderSidenotes(el);
    }
  }

  handleLayoutChange() {
    this.updateSidenotesForAllViews();
  }

  updateSidenotesForAllViews() {
    const workspace = this.app.workspace;
    workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (view && 'getMode' in view && typeof view.getMode === 'function') {
        const mode = view.getMode();
        if (mode === 'preview') {
          const previewMode = (view as any).previewMode;
          if (previewMode && previewMode.containerEl) {
            this.renderSidenotes(previewMode.containerEl);
          }
        }
      }
    });
  }

  handleResize() {
    if (this.settings.dynamicSidenotes) {
      this.updateSidenotesForAllViews();
    }
  }

  async refreshViewMode() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && 'getMode' in view && typeof view.getMode === 'function' && view.getMode() === 'preview') {
        const previewMode = (view as any).previewMode;
        if (previewMode && typeof previewMode.rerender === 'function') {
          await previewMode.rerender(true);
        }
      }
    }
  }

  private getNumberText(index: number): string {
    switch (this.settings.numberingStyle) {
      case 'none':
        return '';
      case 'numeric':
        return `${index}`;
      case 'alphabetic-lower':
        return String.fromCharCode(97 + (index - 1) % 26);
      case 'alphabetic-upper':
        return String.fromCharCode(65 + (index - 1) % 26);
      default:
        return `${index}`;
    }
  }

}

class SidenotesSettingTab extends PluginSettingTab {
  plugin: SidenotesPlugin;

  constructor(app: App, plugin: SidenotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;

    containerEl.empty();

    containerEl.createEl('h2', {text: 'Sidenotes'});

    new Setting(containerEl)
      .setName("Enable sidenotes")
      .setDesc("Toggle sidenotes visibility")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.sidenotesEnabled)
        .onChange(async (value) => {
          this.plugin.settings.sidenotesEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Sidenotes position")
      .setDesc("Choose which side to display sidenotes")
      .addDropdown(dropdown => dropdown
        .addOption("right", "Right")
        .addOption("left", "Left")
        .setValue(this.plugin.settings.sidenotesPosition)
        .onChange(async (value: 'right' | 'left') => {
          this.plugin.settings.sidenotesPosition = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Sidenotes width")
      .setDesc("Width of sidenotes as a percentage of the main content")
      .addSlider(slider => slider
        .setLimits(10, 50, 5)
        .setValue(this.plugin.settings.sidenotesWidth)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.sidenotesWidth = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Sidenotes color")
      .setDesc("Color of sidenotes text")
      .addColorPicker(color => color
        .setValue(this.plugin.settings.sidenotesColor)
        .onChange(async (value) => {
          this.plugin.settings.sidenotesColor = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Auto-convert footnotes")
      .setDesc("Automatically convert footnotes to sidenotes")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoConvertFootnotes)
        .onChange(async (value) => {
          this.plugin.settings.autoConvertFootnotes = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Show in preview mode")
      .setDesc("Display sidenotes in preview mode")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showSidenotesInPreviewMode)
        .onChange(async (value) => {
          this.plugin.settings.showSidenotesInPreviewMode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Show in edit mode")
      .setDesc("Display sidenotes in edit mode")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showSidenotesInEditMode)
        .onChange(async (value) => {
          this.plugin.settings.showSidenotesInEditMode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Numbering style")
      .setDesc("Choose the style for sidenote numbering")
      .addDropdown(dropdown => dropdown
        .addOption("none", "No numbering")
        .addOption("numeric", "Numeric (1, 2, 3, ...)")
        .addOption("alphabetic-lower", "Alphabetic lowercase (a, b, c, ...)")
        .addOption("alphabetic-upper", "Alphabetic uppercase (A, B, C, ...)")
        .setValue(this.plugin.settings.numberingStyle)
        .onChange(async (value: SidenotesPluginSettings['numberingStyle']) => {
          this.plugin.settings.numberingStyle = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Numbering position")
      .setDesc("Choose the position of the sidenote numbering")
      .addDropdown(dropdown => dropdown
        .addOption("superscript", "Superscript")
        .addOption("inline", "Inline")
        .setValue(this.plugin.settings.numberingPosition)
        .onChange(async (value: SidenotesPluginSettings['numberingPosition']) => {
          this.plugin.settings.numberingPosition = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Numbering color")
      .setDesc("Color of the sidenote numbering")
      .addColorPicker(color => color
        .setValue(this.plugin.settings.numberingColor)
        .onChange(async (value) => {
          this.plugin.settings.numberingColor = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Dynamic sidenotes")
      .setDesc("Adjust sidenotes layout based on screen size in preview mode")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.dynamicSidenotes)
        .onChange(async (value) => {
          this.plugin.settings.dynamicSidenotes = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Group inline sidenotes")
      .setDesc("Group sidenotes by paragraph when inline in preview mode")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.inlineSidenotesGrouping)
        .onChange(async (value) => {
          this.plugin.settings.inlineSidenotesGrouping = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Inline breakpoint")
      .setDesc("Screen width (in pixels) at which sidenotes become inline in preview mode")
      .addSlider(slider => slider
        .setLimits(500, 2000, 50)
        .setValue(this.plugin.settings.inlineBreakpoint)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.inlineBreakpoint = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName("Reset to defaults")
      .setDesc("Reset all settings to their default values")
      .addButton(button => button
        .setButtonText("Reset")
        .onClick(async () => {
          await this.resetSettings();
          this.display();
        }));
  }

  async resetSettings() {
    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
    await this.plugin.saveSettings();
    this.plugin.refreshView();
  }
}

class SidenotesPluginView implements PluginValue {
  decorations: DecorationSet;
  sidenotes: Map<number, SidenoteWidget> = new Map();

  constructor(private view: EditorView) {
    this.decorations = this.buildDecorations(view.state);
    this.scheduleMeasurement();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.state);
      this.scheduleMeasurement();
    }
  }

  buildDecorations(state: EditorState): DecorationSet {
    let decorations: CodeMirrorRange<Decoration>[] = [];
    const content = state.doc.toString();
    const referenceRegex = /\[\^(.+?)\](?!:)/g;
    const inlineRegex = /\^\[(.+?)\]/g;
    let match;

    while ((match = referenceRegex.exec(content)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      const ref = match[1];
      const sidenoteContent = this.findSidenoteContent(state, ref);
      if (sidenoteContent) {
        decorations.push(Decoration.widget({
          widget: new SidenoteWidget(sidenoteContent, ref, from, false),
          side: 1
        }).range(to));
      }
    }

    while ((match = inlineRegex.exec(content)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      const inlineContent = match[1];
      decorations.push(Decoration.widget({
        widget: new SidenoteWidget(inlineContent, '', from, true),
        side: 1
      }).range(to));
    }

    return Decoration.set(decorations);
  }

  findSidenoteContent(state: EditorState, ref: string): string | null {
    const content = state.doc.toString();
    const footnoteRegex = new RegExp(`\\[\\^${ref}\\]:\\s*(.+?)(?=\\n\\[\\^|$)`, 's');
    const match = content.match(footnoteRegex);
    return match ? match[1].trim() : null;
  }

  scheduleMeasurement() {
    requestAnimationFrame(() => this.measureAndUpdateLayout());
  }

  measureAndUpdateLayout() {
    const editorRect = this.view.scrollDOM.getBoundingClientRect();

    this.decorations.between(this.view.viewport.from, this.view.viewport.to, (from, to, value) => {
      if (value.spec.widget instanceof SidenoteWidget) {
        const widget = value.spec.widget as SidenoteWidget;
        const coords = this.view.coordsAtPos(from);
        if (coords && widget.dom) {
          const top = coords.top - editorRect.top;
          widget.dom.style.top = `${top}px`;
        }
      }
    });

    this.view.requestMeasure();
  }

  destroy() {
    this.sidenotes.forEach(widget => widget.destroy());
    this.sidenotes.clear();
  }
}

class SidenoteWidget extends WidgetType {
  dom: HTMLElement | null = null;

  constructor(readonly content: string, readonly ref: string, readonly from: number, readonly isInline: boolean) {
    super();
  }

  toDOM() {
    if (this.dom) return this.dom;
    const sidenote = document.createElement('span');
    sidenote.className = 'sidenote';
    if (this.isInline) {
      sidenote.innerHTML = this.content;
    } else {
      sidenote.innerHTML = `<sup>${this.ref}</sup> ${this.content}`;
    }
    this.dom = sidenote;
    return sidenote;
  }

  destroy() {
    if (this.dom && this.dom.parentNode) {
      this.dom.parentNode.removeChild(this.dom);
    }
    this.dom = null;
  }

  eq(other: SidenoteWidget) {
    return this.content === other.content && this.ref === other.ref && this.from === other.from;
  }
}

const sidenotesPlugin = ViewPlugin.fromClass(SidenotesPluginView, {
  decorations: v => v.decorations,
});