import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, MarkdownView, MarkdownPostProcessorContext } from 'obsidian';
import { EditorView, ViewUpdate, PluginValue, ViewPlugin, Decoration, DecorationSet, WidgetType} from "@codemirror/view";
import { EditorState} from "@codemirror/state";

interface SidenotesPluginSettings {
  sidenotesEnabled: boolean;
  sidenotesPosition: 'right' | 'left';
  sidenotesColor: string;
  removeFootnotesInPreview: boolean;
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
  sidenotesColor: '#666666',
  removeFootnotesInPreview: false,
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
      name: 'Reset settings to defaults',
      callback: async () => {
        await this.resetSettings();
        new Notice('Sidenotes settings have been reset to defaults');
      },
    });

    this.addSettingTab(new SidenotesSettingTab(this.app, this));

    this.registerEditorExtension([sidenotesPlugin(this)]);
    this.registerMarkdownPostProcessor(this.postProcessor.bind(this));

    this.loadStyles();
    this.refreshAllViews();

    this.registerEvent(
      this.app.workspace.on('layout-change', this.handleLayoutChange.bind(this))
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf) {
          this.refreshPreviewMode(leaf);
        }
      })
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
    this.loadStyles();
    this.refreshAllViews();
    this.refreshAllPreviewModes();
  }

  updateEditorExtension() {
    this.app.workspace.updateOptions();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.refresh();
      }
    });
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

    const hideFootnotesStyle = this.settings.removeFootnotesInPreview ? `
      .markdown-preview-view .footnotes {
        display: none;
      }
    ` : '';

    const leftSideStyles = `
      .sidenote-left {
        float: left;
        clear: left;
        margin-left: -33%;
        margin-right: 0;
        text-align: right;
        left: -3em;
      }
      .sidenote-left .sidenote-content {
        text-align: right;
      }
    `;

    const rightSideStyles = `
      .sidenote-right {
        float: right;
        clear: right;
        margin-right: -33%;
        margin-left: 0;
        text-align: left;
      }
      .sidenote-right .sidenote-content {
        text-align: left;
      }
    `;

    const dynamicStyles = this.settings.dynamicSidenotes ? `
      @media (max-width: var(--sidenote-inline-breakpoint)) {
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

    styleEl.textContent = `
      ${hideFootnotesStyle}
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
        color: var(--sidenote-color);
      }
      .sidenote-number {
        color: var(--sidenote-number-color);
        margin-right: 0.5em;
      }
      .sidenote-number-superscript {
        vertical-align: super;
        font-size: 0.8em;
      }
      .sidenote-number-inline {
        vertical-align: baseline;
        font-size: 1em;
      }
      ${leftSideStyles}
      ${rightSideStyles}
      ${dynamicStyles}
      .grouped-sidenotes {
        margin-top: 1em;
        padding-left: 1em;
        border-left: 3px solid var(--text-muted);
        color: var(--text-muted);
      }
      .grouped-sidenotes .sidenote {
        margin-bottom: 0.5em;
        font-size: 0.9em;
      }
      .grouped-sidenotes .sidenote:last-child {
        margin-bottom: 0;
      }
      .grouped-sidenotes .sidenote-number {
        font-weight: bold;
      }
      .sidenote-content {
        margin-top: 0;
      }
      :root {
        --sidenote-color: ${this.settings.sidenotesColor};
        --sidenote-number-color: ${this.settings.numberingColor};
        --sidenote-inline-breakpoint: ${this.settings.inlineBreakpoint}px;
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
    
    // Refresh only the active leaf
    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeLeaf) {
      if (activeLeaf.getMode() === 'source') {
        (activeLeaf.editor as any).refresh();
      } else if (activeLeaf.getMode() === 'preview') {
        this.renderSidenotes(activeLeaf.previewMode.containerEl);
      }
    }
  }

  updateSidenotesForAllViews() {
    const workspace = this.app.workspace;
    workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        this.refreshPreviewMode(leaf);
      }
    });
  }

  renderSidenotes(el: HTMLElement) {
    // Remove all existing sidenotes
    el.querySelectorAll('.sidenote, .grouped-sidenotes').forEach(node => node.remove());

    // Reset the global footnote map
    this.resetGlobalFootnoteMap();

    // Only render sidenotes if they are enabled
    if (this.settings.sidenotesEnabled && this.footnoteContents) {
      const footnoteRefs = Array.from(el.querySelectorAll('sup[data-footnote-id]'));
      const footnoteSection = el.querySelector('.footnotes');
      
      const isPreviewMode = el.closest('.markdown-preview-view') !== null;
      const shouldGroupInline = isPreviewMode && 
        this.settings.dynamicSidenotes && 
        this.settings.inlineSidenotesGrouping && 
        window.innerWidth <= this.settings.inlineBreakpoint;

      footnoteRefs.forEach((ref, index) => {
        const id = ref.getAttribute('data-footnote-id');
        if (id) {
          const cleanId = id.replace('fnref-', '').split('-')[0];
          if (!this.globalFootnoteMap.has(cleanId)) {
            this.globalFootnoteMap.set(cleanId, this.currentIndex++);
          }
          const mappedIndex = this.globalFootnoteMap.get(cleanId)!;
          const numberText = this.getNumberText(mappedIndex);
          let content = this.footnoteContents.get(cleanId);

          if (content) {
            // Remove the return arrow from the content
            content = content.replace(/↩︎/g, '').trim();

            // Create sidenote
            const sidenote = document.createElement('span');
            sidenote.className = `sidenote sidenote-${this.settings.sidenotesPosition}`;
            const sidenoteContent = document.createElement('span');
            sidenoteContent.className = 'sidenote-content';
            const numberSpan = document.createElement('span');
            numberSpan.className = `sidenote-number sidenote-number-${this.settings.numberingPosition}`;
            numberSpan.textContent = numberText;
            sidenoteContent.appendChild(numberSpan);
            sidenoteContent.appendChild(document.createTextNode(' ' + content));
            sidenote.appendChild(sidenoteContent);

            // Insert sidenote after the footnote reference
            ref.insertAdjacentElement('afterend', sidenote);

            // Update footnote in the footnotes section
            if (footnoteSection) {
              const footnote = footnoteSection.querySelector(`#fn-${cleanId}`);
              if (footnote) {
                footnote.id = `fn-${numberText}`;
                const backref = footnote.querySelector('.footnote-backref');
                if (backref) {
                  (backref as HTMLAnchorElement).href = `#fnref-${numberText}`;
                }
              }
            }
          }
        }
      });

      // Handle grouped sidenotes if necessary
      if (shouldGroupInline) {
        const groupedSidenotes = document.createElement('div');
        groupedSidenotes.className = 'grouped-sidenotes';
        el.querySelectorAll('.sidenote').forEach(sidenote => {
          groupedSidenotes.appendChild(sidenote.cloneNode(true));
        });
        const lastParagraph = el.querySelector('p:last-of-type');
        if (lastParagraph) {
          lastParagraph.insertAdjacentElement('afterend', groupedSidenotes);
        } else {
          el.appendChild(groupedSidenotes);
        }
      }
    }

    // Remove footnotes if the setting is enabled
    if (this.settings.removeFootnotesInPreview) {
      const footnoteSection = el.querySelector('.footnotes');
      if (footnoteSection) {
        footnoteSection.remove();
      }
    }

    // Force a re-layout
    window.getComputedStyle(el).getPropertyValue('transform');
  }

  postProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (ctx.frontmatter && ctx.frontmatter['position'] === undefined) {
      this.resetGlobalFootnoteMap();
    }

    const footnoteSection = el.querySelector('.footnotes');
    if (footnoteSection) {
      const footnoteContents = new Map();
      footnoteSection.querySelectorAll('li[id^="fn-"]').forEach((li) => {
        const id = li.id.replace('fn-', '').split('-')[0];
        
        // Clone the li element to avoid modifying the original
        const clonedLi = li.cloneNode(true) as HTMLElement;
        
        // Remove the backref link
        const backref = clonedLi.querySelector('a.footnote-backref');
        if (backref) {
          backref.remove();
        }
        
        // Get the text content, removing any remaining HTML tags
        let content = clonedLi.textContent || '';
        content = content.trim().replace(/^\s+|\s+$/gm, '');
        
        footnoteContents.set(id, content);
      });
      this.footnoteContents = footnoteContents;
    }

    // Always call renderSidenotes, it will check if sidenotes should be shown
    this.renderSidenotes(el);
  }

  handleLayoutChange() {
    this.refreshAllViews();
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
      if (view instanceof MarkdownView) {
        if (view.getMode() === 'preview') {
          this.renderSidenotes(view.previewMode.containerEl);
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

  refreshPreviewMode(leaf: WorkspaceLeaf) {
    if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
      const previewMode = leaf.view.previewMode;
      previewMode.rerender(true);
    }
  }

  refreshAllViews() {
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        if (leaf.view.getMode() === 'preview') {
          this.refreshPreviewMode(leaf);
        } else if (leaf.view.getMode() === 'source') {
          const cmEditor = (leaf.view.editor as any).cm;
          if (cmEditor) {
            const plugin = cmEditor.plugin(sidenotesPlugin(this));
            if (plugin) {
              plugin.sidenotesView.manualRefresh();
              cmEditor.update([]);
            }
          }
        }
      }
    });
  }

  refreshAllPreviewModes() {
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
        this.refreshPreviewMode(leaf);
      }
    });
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
          this.plugin.refreshAllViews();
        }));

    new Setting(containerEl)
      .setName("Sidenotes color")
      .setDesc("Color of sidenotes text")
      .addColorPicker(color => color
        .setValue(this.plugin.settings.sidenotesColor)
        .onChange(async (value) => {
          this.plugin.settings.sidenotesColor = value;
          document.documentElement.style.setProperty('--sidenote-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Remove footnotes in preview mode")
      .setDesc("Hide the footnotes section at the bottom of the document in preview mode")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.removeFootnotesInPreview)
        .onChange(async (value) => {
          this.plugin.settings.removeFootnotesInPreview = value;
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
          document.documentElement.style.setProperty('--sidenote-number-color', value);
          await this.plugin.saveSettings();
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
  private plugin: SidenotesPlugin;
  private settings: SidenotesPluginSettings;

  constructor(private view: EditorView, plugin: SidenotesPlugin) {
    this.plugin = plugin;
    this.settings = { ...plugin.settings };
    this.decorations = this.buildDecorations(view.state);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || this.settingsChanged()) {
      this.decorations = this.buildDecorations(update.state);
      return true;
    }
    return false;
  }

  settingsChanged() {
    const currentSettings = this.plugin.settings;
    if (JSON.stringify(this.settings) !== JSON.stringify(currentSettings)) {
      this.settings = { ...currentSettings };
      return true;
    }
    return false;
  }

  manualRefresh() {
    this.settings = { ...this.plugin.settings };
    this.decorations = Decoration.none;
    this.decorations = this.buildDecorations(this.view.state);
  }

  buildDecorations(state: EditorState): DecorationSet {
    let decorations: {from: number, to: number, decoration: Decoration}[] = [];
    
    if (this.plugin.settings.sidenotesEnabled && this.plugin.settings.showSidenotesInEditMode) {
      const content = state.doc.toString();
      const referenceRegex = /\[\^([^\]]*)\](?!:)/g;
      const inlineRegex = /\^\[(.+?)\]/g;
      let match;
  
      // Handle reference-style footnotes
      while ((match = referenceRegex.exec(content)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const ref = match[1];
        
        if (ref.trim() !== '') {
          try {
            const sidenoteContent = this.findSidenoteContent(state, ref);
            if (sidenoteContent) {
              const numberText = ref;
              decorations.push({
                from: to,
                to: to,
                decoration: Decoration.widget({
                  widget: new SidenoteWidget(sidenoteContent, numberText, from, false, this.plugin),
                  side: 1
                })
              });
            }
          } catch (error) {
            console.error(`Error processing sidenote ref "${ref}":`, error);
          }
        } 
        // else {
        //   console.log(`Empty footnote reference found at position ${from}`);
        // }
      }
  
      // Handle inline footnotes
      while ((match = inlineRegex.exec(content)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const inlineContent = match[1];
        const numberText = "";
  
        try {
          decorations.push({
            from: to,
            to: to,
            decoration: Decoration.widget({
              widget: new SidenoteWidget(inlineContent, numberText, from, true, this.plugin),
              side: 1
            })
          });
        } catch (error) {
          console.error(`Error processing inline footnote:`, error);
        }
      }
    }
  
    // Sort decorations by 'from' position
    decorations.sort((a, b) => a.from - b.from);
  
    // Create the DecorationSet from the sorted decorations
    return Decoration.set(decorations.map(d => d.decoration.range(d.from)));
  }

  findSidenoteContent(state: EditorState, ref: string): string | null {
    if (!ref || ref.trim() === '') return null;

    const content = state.doc.toString();
    const lines = content.split('\n');
    const footnoteMarker = `[^${ref}]:`;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(footnoteMarker)) {
        let footnoteContent = lines[i].substring(footnoteMarker.length).trim();
        
        // Check for multi-line footnotes
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith(' ')) {
          i++;
          footnoteContent += ' ' + lines[i].trim();
        }
        
        return footnoteContent;
      }
    }
    
    return null;
  }

  destroy() {
    // Clean up if necessary
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
    sidenote.className = `sidenote sidenote-${this.plugin.settings.sidenotesPosition}`;

    if (this.numberText) {
      const numberSpan = document.createElement('span');
      numberSpan.className = `sidenote-number sidenote-number-${this.plugin.settings.numberingPosition}`;
      numberSpan.textContent = this.numberText;

      sidenote.appendChild(numberSpan);
      sidenote.appendChild(document.createTextNode(' '));
    }

    sidenote.appendChild(document.createTextNode(this.content));

    this.dom = sidenote;
    return sidenote;
  }

  setPosition(top: number, right: number, width: number) {
    if (this.dom) {
      this.dom.style.position = 'absolute';
      this.dom.style.top = `${top}px`;
      this.dom.style.right = `${right}px`;
      this.dom.style.width = `${width}px`;
      this.dom.style.marginTop = '0';
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
    sidenotesView: SidenotesPluginView;

    constructor(view: EditorView) {
      this.sidenotesView = new SidenotesPluginView(view, plugin);
    }

    update(update: ViewUpdate) {
      return this.sidenotesView.update(update);
    }

    destroy() {
      // Clean up if necessary
    }
  },
  {
    decorations: v => v.sidenotesView.decorations,
    provide: plugin => EditorView.atomicRanges.of(view => {
      return view.plugin(plugin)?.sidenotesView.decorations || Decoration.none;
    })
  }
);