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
  private globalFootnoteMap: Map<string, number> = new Map();
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

    this.registerEditorExtension([sidenotesPlugin(this)]);
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
        margin-top: 0;
      }
      .sidenote::before {
        content: attr(data-number);
        margin-right: 0.5em;
        vertical-align: super;
        font-size: 0.8em;
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
      .sidenote-content {
        margin-top: 0;
      }
    `;
  }

  refreshView() {
    this.loadStyles();
    if (!this.settings.sidenotesEnabled) {
      // Remove all sidenotes if they are disabled
      document.querySelectorAll('.sidenote, .grouped-sidenotes').forEach(node => node.remove());
    }
    this.updateSidenotesForAllViews();
    this.app.workspace.updateOptions();
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
        } else if (mode === 'source') {
          // Trigger a refresh for the editor view
          (view as any).editor.refresh();
        }
      }
    });
  }

  renderSidenotes(el: HTMLElement) {
    // Remove existing sidenotes
    el.querySelectorAll('.sidenote, .grouped-sidenotes').forEach(node => node.remove());

    // Only render sidenotes if they are enabled
    if (this.settings.sidenotesEnabled && this.footnoteContents) {
      const footnoteRefs = Array.from(el.querySelectorAll('sup[data-footnote-id]'));
      
      const isPreviewMode = el.closest('.markdown-preview-view') !== null;
      const shouldGroupInline = isPreviewMode && 
                                this.settings.dynamicSidenotes && 
                                this.settings.inlineSidenotesGrouping && 
                                window.innerWidth <= this.settings.inlineBreakpoint;
      
      if (shouldGroupInline) {
        // ... (existing code for grouped sidenotes)
      } else {
        footnoteRefs.forEach(ref => {
          const id = ref.getAttribute('data-footnote-id');
          if (id) {
            const cleanId = id.replace('fnref-', '').split('-')[0];
            if (!this.globalFootnoteMap.has(cleanId)) {
              this.globalFootnoteMap.set(cleanId, this.currentIndex++);
            }
            const index = this.globalFootnoteMap.get(cleanId)!;
            const numberText = this.getNumberText(index);
            const content = this.footnoteContents.get(cleanId);
            if (content) {
              const sidenote = document.createElement('span');
              sidenote.className = 'sidenote';
              const wrapper = document.createElement('span');
              wrapper.className = 'sidenote-content';
              wrapper.innerHTML = `<sup>${numberText}</sup> ${content}`;
              sidenote.appendChild(wrapper);
              ref.insertAdjacentElement('afterend', sidenote);
              
              // Update the footnote reference in the text
              ref.innerHTML = `[${numberText}]`;
            }
          }
        });
      }
    }
  }

  postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    if (ctx.frontmatter && ctx.frontmatter['position'] === undefined) {
      this.resetGlobalFootnoteMap();
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

    // Always call renderSidenotes, it will check if sidenotes should be shown
    this.renderSidenotes(el);
  }

  handleLayoutChange() {
    this.updateSidenotesForAllViews();
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

  resetGlobalFootnoteMap() {
    this.globalFootnoteMap.clear();
    this.currentIndex = 1;
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
  private plugin: SidenotesPlugin;

  constructor(private view: EditorView, plugin: SidenotesPlugin) {
    this.plugin = plugin;
    this.decorations = this.buildDecorations(view.state);
    this.scheduleMeasurement();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.transactions.some(tr => tr.reconfigured)) {
      this.decorations = this.buildDecorations(update.state);
      this.scheduleMeasurement();
    }
  }

  buildDecorations(state: EditorState): DecorationSet {
    let decorations: CodeMirrorRange<Decoration>[] = [];
    
    if (this.plugin.settings.sidenotesEnabled && this.plugin.settings.showSidenotesInEditMode) {
      const content = state.doc.toString();
      const referenceRegex = /\[\^(.+?)\](?!:)/g;
      let match;

      while ((match = referenceRegex.exec(content)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const ref = match[1];
        const sidenoteContent = this.findSidenoteContent(state, ref);
        if (sidenoteContent) {
          // Use the original reference as the numberText
          const numberText = ref;
          decorations.push(Decoration.widget({
            widget: new SidenoteWidget(sidenoteContent, numberText, from, false, this.plugin),
            side: 1
          }).range(to));
        }
      }

      // ... (handle inline sidenotes if needed)
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
    const contentWidth = editorRect.width;
    const sidenotesWidth = this.plugin.settings.sidenotesEnabled ? editorRect.width * 0.3 : 0;
  
    if (!this.plugin.settings.sidenotesEnabled) {
      // Remove all sidenote widgets if sidenotes are disabled
      this.sidenotes.forEach(widget => widget.destroy());
      this.sidenotes.clear();
    }

    // Adjust the content area only if sidenotes are enabled
    const contentArea = this.view.contentDOM;
    if (this.plugin.settings.sidenotesEnabled) {
      contentArea.style.width = `100%`;
      contentArea.style.marginRight = `${sidenotesWidth}px`;
    } else {
      contentArea.style.width = '100%';
      contentArea.style.marginRight = '0';
    }
  
    this.view.requestMeasure();
  }

  destroy() {
    this.sidenotes.forEach(widget => widget.destroy());
    this.sidenotes.clear();
  }
}

class SidenoteWidget extends WidgetType {
  dom: HTMLElement | null = null;

  constructor(
    readonly content: string, 
    readonly numberText: string, 
    readonly from: number, 
    readonly isInline: boolean,
    private plugin: SidenotesPlugin
  ) {
    super();
  }

  toDOM() {
    if (this.dom) return this.dom;
    const sidenote = document.createElement('span');
    sidenote.className = 'sidenote';
    if (this.isInline) {
      sidenote.innerHTML = this.content;
    } else {
      sidenote.innerHTML = `<sup>${this.numberText}</sup> ${this.content}`;
    }
    this.dom = sidenote;
    return sidenote;
  }

  setPosition(top: number, right: number, width: number) {
    if (this.dom) {
      this.dom.style.position = 'absolute';
      this.dom.style.top = `${top}px`;
      this.dom.style.right = `${right}px`;
      this.dom.style.width = `${width}px`;
      this.dom.style.marginTop = '0'; // Add this line to remove any top margin
    }
  }

  destroy() {
    if (this.dom && this.dom.parentNode) {
      this.dom.parentNode.removeChild(this.dom);
    }
    this.dom = null;
  }

  eq(other: SidenoteWidget) {
    return this.content === other.content && this.numberText === other.numberText && this.from === other.from;
  }
}

const sidenotesPlugin = (plugin: SidenotesPlugin) => ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      return new SidenotesPluginView(view, plugin);
    }
  },
  {
    decorations: v => (v as SidenotesPluginView).decorations,
  }
);