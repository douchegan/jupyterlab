// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JSONExt, JSONObject, JSONValue, PromiseDelegate
} from '@phosphor/coreutils';

import {
  IDisposable
} from '@phosphor/disposable';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  IDatastore
} from '.';


/**
 * The default level that is used when level is unspecified in a request.
 */
const LEVEL: ISettingRegistry.Level = 'user';


/**
 * A namespace for setting registry interfaces.
 */
export
namespace ISettingRegistry {
  /**
   * The setting level: user or system.
   */
  export
  type Level = 'user' | 'system';

  /**
   * A collection of setting data for a specific key.
   */
  export
  type Bundle = {
    [level in Level]?: { [key: string]: JSONValue } | null;
  };

  /**
   * An annotation for a specific setting.
   */
  export
  interface IAnnotation extends JSONObject {
    /**
     * The caption for the setting.
     */
    caption?: string;

    /**
     * The extra class name for the setting.
     */
    className?: string;

    /**
     * The icon class for the setting.
     */
    iconClass?: string;

    /**
     * The icon label for the setting.
     */
    iconLabel?: string;

    /**
     * The label for the setting.
     */
    label?: string;
  }

  /**
   * The settings for a specific plugin.
   */
  export
  interface IPlugin extends JSONObject {
    /**
     * The name of a plugin whose settings are saved.
     */
    id: string;

    /**
     * The style and icon annotation for all settings in this plugin.
     */
    annotation?: IAnnotation | null;

    /**
     * The collection of values for a specified setting.
     */
    data: Bundle | null;
  }

  /**
   * An interface for manipulating the settings of a specific plugin.
   */
  export
  interface ISettings extends IDisposable {
    /**
     * The plugin name.
     */
    readonly plugin: string;

    /**
     * Get an individual setting.
     *
     * @param key - The name of the setting being retrieved.
     *
     * @param level - The setting level. Defaults to `user`.
     *
     * @returns A promise that resolves when the setting is retrieved.
     */
    get(key: string, level?: ISettingRegistry.Level): Promise<JSONValue>;

    /**
     * Remove a single setting.
     *
     * @param key - The name of the setting being removed.
     *
     * @param level - The setting level. Defaults to `user`.
     *
     * @returns A promise that resolves when the setting is removed.
     */
    remove(key: string, level?: ISettingRegistry.Level): Promise<void>;

    /**
     * Set a single setting.
     *
     * @param key - The name of the setting being set.
     *
     * @param value - The value of the setting.
     *
     * @param level - The setting level. Defaults to `user`.
     *
     * @returns A promise that resolves when the setting has been saved.
     *
     */
    set(key: string, value: JSONValue, level?: ISettingRegistry.Level): Promise<void>;
  };
}


/**
 * An implementation of a setting registry.
 */
export
interface ISettingRegistry extends SettingRegistry {}


/**
 * The default concrete implementation of a setting registry.
 */
export
class SettingRegistry {
  /**
   * A signal that emits name of a plugin when its settings change.
   */
  get pluginChanged(): ISignal<this, string> {
    return this._pluginChanged;
  }

  /**
   * Returns a list of plugin settings held in the registry.
   */
  get plugins(): ISettingRegistry.IPlugin[] {
    const annotations = this._annotations;
    const plugins = this._plugins;

    return Object.keys(plugins).map(plugin => {
      // Create a copy of the plugin data.
      const result = JSONExt.deepCopy(plugins[plugin]);

      // Copy over any annotations that may be available.
      result.annotations = JSONExt.deepCopy(annotations[plugin] || null);

      return result as ISettingRegistry.IPlugin;
    });
  }

  /**
   * Annotate a specific setting item for places where it might be displayed.
   *
   * @param plugin - The name of the plugin whose setting is being annotated.
   *
   * @param key - The name of the setting being annotated.
   *
   * @param annotation - The annotation describing an individual setting.
   */
  annotate(plugin: string, key: string, annotation: ISettingRegistry.IAnnotation): void {
    if (!this._annotations[plugin]) {
      this._annotations[plugin] = Object.create(null);
    }
    this._annotations[plugin][key] = annotation;
    this._pluginChanged.emit(plugin);
  }

  /**
   * Get an individual setting.
   *
   * @param plugin - The name of the plugin whose settings are being retrieved.
   *
   * @param key - The name of the setting being retrieved.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting is retrieved.
   */
  get(plugin: string, key: string, level: ISettingRegistry.Level = LEVEL): Promise<JSONValue> {
    if (plugin in this._plugins) {
      const bundle = this._plugins[plugin] && this._plugins[plugin].data;
      const value = bundle && bundle[level] && bundle[level][key] || null;

      return Promise.resolve(JSONExt.deepCopy(value));
    }

    return this.load(plugin).then(() => this.get(plugin, key, level));
  }

  /**
   * Load a plugin's settings into the setting registry.
   *
   * @param plugin - The name of the plugin whose settings are being loaded.
   *
   * @param reload - Reload from server, ignoring cache. Defaults to false.
   *
   * @returns A promise that resolves with a plugin settings object.
   */
  load(plugin: string, reload = false): Promise<ISettingRegistry.ISettings> {
    const annotations = this._annotations;
    const plugins = this._plugins;
    const registry = this;
    const copy = JSONExt.deepCopy;

    // If the plugin exists and does not need to be reloaded, resolve.
    if (!reload && plugin in plugins) {
      // Create a copy of the plugin data.
      const content = copy(plugins[plugin]) as ISettingRegistry.IPlugin;

      // Copy over any annotations that may be available.
      content.annotations = copy(annotations[plugin] || null);

      return Promise.resolve(new Settings({ content, plugin, registry }));
    }

    // If the plugin needs to be loaded from the datastore, fetch.
    if (this._datastore) {
      return this._datastore.fetch(plugin).then(result => {
        // Set the local copy.
        plugins[result.id] = result;

        // Create a copy of the plugin data.
        const content = copy(result) as ISettingRegistry.IPlugin;

        // Copy over any annotations that may be available.
        content.annotations = copy(annotations[plugin] || null);

        return new Settings({ content, plugin, registry });
      });
    }

    // If the setting registry is not ready yet, wait.
    return this._ready.promise.then(() => this.load(plugin));
  }

  /**
   * Remove a single setting in the registry.
   *
   * @param plugin - The name of the plugin whose setting is being removed.
   *
   * @param key - The name of the setting being removed.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting is removed.
   */
  remove(plugin: string, key: string, level: ISettingRegistry.Level = LEVEL): Promise<void> {
    if (!(plugin in this._plugins)) {
      return Promise.resolve(void 0);
    }

    const bundle =  this._plugins[plugin].data;
    if (!bundle[level]) {
      return Promise.resolve(void 0);
    }

    delete bundle[level][key];

    return this._save(plugin);
  }

  /**
   * Set a single setting in the registry.
   *
   * @param plugin - The name of the plugin whose setting is being set.
   *
   * @param key - The name of the setting being set.
   *
   * @param value - The value of the setting being set.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting has been saved.
   *
   */
  set(plugin: string, key: string, value: JSONValue, level: ISettingRegistry.Level = LEVEL): Promise<void> {
    if (!(plugin in this._plugins)) {
      return this.load(plugin).then(() => this.set(plugin, key, value, level));
    }

    const bundle = this._plugins[plugin].data;

    if (!bundle[level]) {
      bundle[level] = {};
    }
    bundle[level][key] = value;

    return this._save(plugin);
  }

  /**
   * Set the setting registry datastore.
   *
   * @param datastore - The datastore for the setting registry.
   *
   * @throws If a datastore has already been set.
   *
   * #### Notes
   * The setting registry datastore must read, write, and delete settings for an
   * entire extension at a time. It is comparable to a single file written to
   * disk on a file system.
   */
  setDB(datastore: IDatastore<ISettingRegistry.IPlugin, ISettingRegistry.IPlugin>) {
    if (this._datastore) {
      throw new Error('Setting registry already has a datastore.');
    }

    this._datastore = datastore;
    this._ready.resolve(void 0);
  }

  /**
   * Upload a plugin's settings.
   *
   * @param plugin - The plugin settings being uploaded.
   *
   * @returns A promise that resolves when the settings have been saved.
   */
  upload(plugin: ISettingRegistry.IPlugin): Promise<void> {
    this._plugins[plugin.id] = plugin;
    return this._save(plugin.id);
  }

  /**
   * Save a plugin in the registry.
   */
  private _save(plugin: string): Promise<void> {
    return this._datastore.save(plugin, this._plugins[plugin])
      .then(() => { this._pluginChanged.emit(plugin); });
  }

  private _annotations: { [plugin: string]: { [key: string]: ISettingRegistry.IAnnotation } } = Object.create(null);
  private _datastore: IDatastore<ISettingRegistry.IPlugin, ISettingRegistry.IPlugin> | null = null;
  private _pluginChanged = new Signal<this, string>(this);
  private _plugins: { [name: string]: ISettingRegistry.IPlugin } = Object.create(null);
  private _ready = new PromiseDelegate<void>();
}


/**
 * A manager for a specific plugin's settings.
 */
class Settings implements ISettingRegistry.ISettings {
  /**
   * Instantiate a new plugin settings manager.
   */
  constructor(options: Settings.IOptions) {
    this._content = options.content;
    this.plugin = options.plugin;
    this.registry = options.registry;
  }

  /**
   * Test whether the plugin settings manager disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * The plugin name.
   */
  readonly plugin: string;

  /**
   * The system registry instance used by the settings manager.
   */
  readonly registry: SettingRegistry;

  /**
   * Dispose of the plugin settings resources.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;
    this._content = null;
  }

  /**
   * Get an individual setting.
   *
   * @param key - The name of the setting being retrieved.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting is retrieved.
   */
  get(key: string, level: ISettingRegistry.Level = LEVEL): Promise<JSONValue> {
    return this.registry.get(this.plugin, key, level);
  }

  /**
   * Remove a single setting.
   *
   * @param key - The name of the setting being removed.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting is removed.
   */
  remove(key: string, level: ISettingRegistry.Level = LEVEL): Promise<void> {
    return this.registry.remove(this.plugin, key, level);
  }

  /**
   * Set a single setting.
   *
   * @param key - The name of the setting being set.
   *
   * @param value - The value of the setting.
   *
   * @param level - The setting level. Defaults to `user`.
   *
   * @returns A promise that resolves when the setting has been saved.
   *
   */
  set(key: string, value: JSONValue, level: ISettingRegistry.Level = LEVEL): Promise<void> {
    return this.registry.set(this.plugin, key, value, level);
  }

  private _content: ISettingRegistry.IPlugin | null = null;
  private _isDisposed = false;
}


/**
 * A namespace for `Settings` statics.
 */
namespace Settings {
  /**
   * The instantiation options for a `Settings` object.
   */
  export
  interface IOptions {
    /**
     * The actual setting values for a plugin.
     */
    content?: ISettingRegistry.IPlugin;

    /**
     * The plugin that the settings object references.
     */
    plugin: string;

    /**
     * The system registry instance used by the settings manager.
     */
    registry: SettingRegistry;
  }
}
