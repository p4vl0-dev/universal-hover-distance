/**
 * Universal Hover Distance
 * ---------------------------------------------------------------
 * При наведении курсора на токен рисует плашку с расстоянием от
 * выбранных (controlled) токенов (либо от персонажа пользователя,
 * если ничего не выбрано) до токена под курсором. Работает с любой
 * игровой системой Foundry VTT.
 *
 * Дистанция считается через scene.grid.measurePath() (v12+), который
 * учитывает 3D-координаты (x, y, elevation).
 *
 * Использованное Foundry API:
 *  - Hooks: hoverToken, refreshToken, controlToken, deleteToken,
 *           canvasReady, canvasPan, highlightObjects, updateCombat,
 *           deleteCombat, renderSettingsConfig
 *  - TokenDocument#getCenterPoint(), Scene#grid.measurePath()
 * https://foundryvtt.com/api/
 */

const MODULE_ID = "universal-hover-distance";

/** tokenId -> PIXI.Container (badge + label) */
const activeLabels = new Map();

/** true, пока зажата клавиша "Подсветка объектов" (по умолчанию Alt) */
let highlightActive = false;

/** Настройки оформления, которые ГМ может навязать игрокам (enforceGMStyle). */
const STYLE_KEYS = [
  "precision", "unit",
  "sizeMode", "anchor", "offset",
  "fontFamily", "fontSize", "fontBold", "fontColor", "strokeColor", "strokeWidth",
  "badgeEnabled", "badgeColor", "badgeOpacity", "badgePadding"
];

/** Первая настройка раздела -> ключ локализации заголовка раздела.
 *  (Порядок настроек в меню = порядок регистрации ниже.) */
const SECTION_HEADERS = {
  enabled: "general",
  precision: "numbers",
  sizeMode: "position",
  fontFamily: "text",
  badgeEnabled: "badge",
  enforceGMStyle: "sync"
};

/** Вертикальный внутренний отступ подложки (px). */
const BADGE_PAD_Y = 6;

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

function colorSetting(key, initial) {
  game.settings.register(MODULE_ID, key, {
    name: `${MODULE_ID}.settings.${key}.name`,
    hint: `${MODULE_ID}.settings.${key}.hint`,
    scope: "client",
    config: true,
    type: new foundry.data.fields.ColorField({ required: true, nullable: false, initial }),
    input: (field, config) => foundry.applications.elements.HTMLColorPickerElement.create(config),
    default: initial,
    onChange: onStyleChange(key)
  });
}

function styleSetting(key, data) {
  game.settings.register(MODULE_ID, key, {
    name: `${MODULE_ID}.settings.${key}.name`,
    hint: `${MODULE_ID}.settings.${key}.hint`,
    scope: "client",
    config: true,
    onChange: onStyleChange(key),
    ...data
  });
}

function registerSettings() {
  /* --- Общие ------------------------------------------------------- */
  game.settings.register(MODULE_ID, "enabled", {
    name: `${MODULE_ID}.settings.enabled.name`,
    hint: `${MODULE_ID}.settings.enabled.hint`,
    scope: "client", config: true, type: Boolean, default: true,
    onChange: onVisibilityChange
  });

  game.settings.register(MODULE_ID, "combatOnly", {
    name: `${MODULE_ID}.settings.combatOnly.name`,
    hint: `${MODULE_ID}.settings.combatOnly.hint`,
    scope: "client", config: true, type: Boolean, default: false,
    onChange: onVisibilityChange
  });

  game.settings.register(MODULE_ID, "altShowAll", {
    name: `${MODULE_ID}.settings.altShowAll.name`,
    hint: `${MODULE_ID}.settings.altShowAll.hint`,
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => syncHighlightLabels()
  });

  /* --- Значение расстояния ---------------------------------------- */
  styleSetting("precision", {
    type: String,
    choices: {
      "0": `${MODULE_ID}.settings.precision.choices.0`,
      "1": `${MODULE_ID}.settings.precision.choices.1`,
      "2": `${MODULE_ID}.settings.precision.choices.2`
    },
    default: "1"
  });
  styleSetting("unit", { type: String, default: "in" });

  /* --- Положение и размер ----------------------------------------- */
  styleSetting("sizeMode", {
    type: String,
    choices: {
      static: `${MODULE_ID}.settings.sizeMode.choices.static`,
      adaptive: `${MODULE_ID}.settings.sizeMode.choices.adaptive`
    },
    default: "static"
  });
  styleSetting("anchor", {
    type: String,
    choices: {
      top: `${MODULE_ID}.settings.anchor.choices.top`,
      bottom: `${MODULE_ID}.settings.anchor.choices.bottom`,
      center: `${MODULE_ID}.settings.anchor.choices.center`
    },
    default: "top"
  });
  styleSetting("offset", { type: Number, range: { min: 0, max: 100, step: 1 }, default: 40 });

  /* --- Стиль текста ----------------------------------------------- */
  styleSetting("fontFamily", { type: String, default: "Signika" });
  styleSetting("fontSize", { type: Number, range: { min: 10, max: 64, step: 1 }, default: 26 });
  styleSetting("fontBold", { type: Boolean, default: false });
  colorSetting("fontColor", "#ffffff");
  colorSetting("strokeColor", "#000000");
  styleSetting("strokeWidth", { type: Number, range: { min: 0, max: 20, step: 1 }, default: 4 });

  /* --- Плашка-подложка -------------------------------------------- */
  styleSetting("badgeEnabled", { type: Boolean, default: true });
  colorSetting("badgeColor", "#000000");
  styleSetting("badgeOpacity", { type: Number, range: { min: 0, max: 100, step: 5 }, default: 55 });
  styleSetting("badgePadding", { type: Number, range: { min: 0, max: 40, step: 1 }, default: 10 });

  /* --- Синхронизация с ГМ ----------------------------------------- */
  // world-scope: Foundry сам блокирует поле для игроков, менять может только ГМ.
  game.settings.register(MODULE_ID, "enforceGMStyle", {
    name: `${MODULE_ID}.settings.enforceGMStyle.name`,
    hint: `${MODULE_ID}.settings.enforceGMStyle.hint`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: onToggleEnforce
  });

  // Снимок оформления ГМ (скрыт из UI), рассылается клиентам как world-setting.
  game.settings.register(MODULE_ID, "gmStyleSnapshot", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => refreshAllLabels()
  });
}

/** Значение настройки оформления с учётом enforceGMStyle. */
function getStyleSetting(key) {
  if (game.settings.get(MODULE_ID, "enforceGMStyle") && !game.user.isGM) {
    const snapshot = game.settings.get(MODULE_ID, "gmStyleSnapshot") || {};
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) return snapshot[key];
  }
  return game.settings.get(MODULE_ID, key);
}

function onStyleChange(key) {
  return (value) => {
    if (game.user.isGM && game.settings.get(MODULE_ID, "enforceGMStyle")) {
      updateGMSnapshot(key, value);
    }
    refreshAllLabels();
  };
}

async function updateGMSnapshot(key, value) {
  const snapshot = foundry.utils.deepClone(game.settings.get(MODULE_ID, "gmStyleSnapshot") || {});
  snapshot[key] = value;
  await game.settings.set(MODULE_ID, "gmStyleSnapshot", snapshot);
}

async function onToggleEnforce(enabled) {
  if (enabled && game.user.isGM) {
    const snapshot = {};
    for (const key of STYLE_KEYS) snapshot[key] = game.settings.get(MODULE_ID, key);
    await game.settings.set(MODULE_ID, "gmStyleSnapshot", snapshot);
  }
  refreshAllLabels();
}

/** Заголовки разделов в меню настроек + блокировка полей для игроков. */
function decorateSettingsConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  // Заголовки разделов
  for (const [firstKey, section] of Object.entries(SECTION_HEADERS)) {
    const input = root.querySelector(`[name="${MODULE_ID}.${firstKey}"]`);
    const group = input?.closest(".form-group");
    if (!group || group.previousElementSibling?.classList.contains("uhd-section-header")) continue;

    const header = document.createElement("h4");
    header.className = "uhd-section-header";
    header.textContent = game.i18n.localize(`${MODULE_ID}.settings.sections.${section}`);
    header.style.cssText = "margin: 1em 0 0.4em; padding-bottom: 0.2em; border-bottom: 1px solid var(--color-border-light-2, #8887);";
    group.before(header);
  }

  // Блокировка для игроков
  if (!game.settings.get(MODULE_ID, "enforceGMStyle") || game.user.isGM) return;
  for (const key of STYLE_KEYS) {
    const input = root.querySelector(`[name="${MODULE_ID}.${key}"]`);
    if (!input) continue;
    input.disabled = true;
    const group = input.closest(".form-group");
    if (group && !group.querySelector(".uhd-locked-note")) {
      const note = document.createElement("p");
      note.className = "notes uhd-locked-note";
      note.textContent = game.i18n.localize(`${MODULE_ID}.settings.lockedByGM`);
      group.appendChild(note);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Distance calculation                                              */
/* ------------------------------------------------------------------ */

/** Выбранные токены пользователя, а если ничего не выбрано — токен его персонажа. */
function getReferenceTokens(hoveredToken) {
  let refs = canvas.tokens.controlled.filter((t) => t.id !== hoveredToken.id);

  if (!refs.length) {
    const character = game.user.character;
    if (character) {
      const ownToken = canvas.tokens.placeables.find(
        (t) => t.actor?.id === character.id && t.id !== hoveredToken.id
      );
      if (ownToken) refs = [ownToken];
    }
  }
  return refs;
}

function measureDistance(tokenA, tokenB) {
  const scene = canvas.scene;
  if (!scene?.grid) return 0;
  const result = scene.grid.measurePath(
    [tokenA.document.getCenterPoint(), tokenB.document.getCenterPoint()], {}
  );
  return result.distance;
}

function formatDistance(value) {
  return value.toFixed(Number(getStyleSetting("precision")));
}

/** Текст плашки; null, если мерить не от кого. */
function computeLabelText(hoveredToken) {
  const references = getReferenceTokens(hoveredToken);
  if (!references.length) return null;

  const unit = getStyleSetting("unit");
  const showNames = references.length > 1;

  return references.map((ref) => {
    const formatted = `${formatDistance(measureDistance(ref, hoveredToken))} ${unit}`;
    return showNames ? `${ref.name}: ${formatted}` : formatted;
  }).join("\n");
}

/* ------------------------------------------------------------------ */
/*  Colors                                                            */
/* ------------------------------------------------------------------ */

function toColorString(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") return "#" + value.toString(16).padStart(6, "0");
  return value.toString?.() ?? fallback;
}

function toColorNumber(value, fallback) {
  const str = toColorString(value, null);
  if (!str) return fallback;
  const n = Number(str.replace("#", "0x"));
  return Number.isNaN(n) ? fallback : n;
}

/* ------------------------------------------------------------------ */
/*  Label rendering                                                   */
/* ------------------------------------------------------------------ */

function getTextClass() {
  return foundry?.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
}

function buildTextStyle() {
  return new PIXI.TextStyle({
    fontFamily: getStyleSetting("fontFamily") || "Signika",
    fontSize: Number(getStyleSetting("fontSize")) || 26,
    fontWeight: getStyleSetting("fontBold") ? "bold" : "normal",
    fill: toColorString(getStyleSetting("fontColor"), "#ffffff"),
    stroke: toColorString(getStyleSetting("strokeColor"), "#000000"),
    strokeThickness: Number(getStyleSetting("strokeWidth")) || 0,
    lineJoin: "round",
    align: "center"
  });
}

/** Ставит текст относительно точки крепления контейнера.
 *  top    -> низ плашки лежит на точке (плашка над ней)
 *  bottom -> верх плашки лежит на точке (плашка под ней)
 *  center -> центр плашки в точке */
function layoutLabel(label) {
  const anchor = getStyleSetting("anchor");
  const pad = getStyleSetting("badgeEnabled") ? BADGE_PAD_Y : 0;

  if (anchor === "center") {
    label.anchor.set(0.5, 0.5);
    label.position.set(0, 0);
  } else if (anchor === "bottom") {
    label.anchor.set(0.5, 0);
    label.position.set(0, pad);
  } else {
    label.anchor.set(0.5, 1);
    label.position.set(0, -pad);
  }
}

function drawBadge(badge, label) {
  badge.clear();
  if (!getStyleSetting("badgeEnabled")) return;

  const b = label.getLocalBounds();
  const padX = Math.max(0, Number(getStyleSetting("badgePadding")) || 0);
  const opacity = Math.min(100, Math.max(0, Number(getStyleSetting("badgeOpacity")))) / 100;
  const color = toColorNumber(getStyleSetting("badgeColor"), 0x000000);

  badge.beginFill(color, opacity);
  badge.lineStyle(1, color, Math.min(1, opacity + 0.25));
  badge.drawRoundedRect(
    label.x + b.x - padX,
    label.y + b.y - BADGE_PAD_Y,
    b.width + padX * 2,
    b.height + BADGE_PAD_Y * 2,
    8
  );
  badge.endFill();
}

/**
 * Точка крепления плашки:
 *  top    -> верхний край токена, минус offset (плашка уходит вверх)
 *  bottom -> нижний край токена, плюс offset (плашка уходит вниз)
 *  center -> центр токена (offset не применяется)
 */
function positionWrapper(wrapper, token) {
  const anchor = getStyleSetting("anchor");
  const offset = Number(getStyleSetting("offset")) || 0;
  const width = token.w ?? token.document.width * canvas.grid.size;
  const height = token.h ?? token.document.height * canvas.grid.size;

  wrapper.x = width / 2;
  if (anchor === "center") wrapper.y = height / 2;
  else if (anchor === "bottom") wrapper.y = height + offset;
  else wrapper.y = -offset;

  applyAdaptiveScale(wrapper);
}

/** Адаптивный режим: постоянный размер на экране независимо от зума. */
function applyAdaptiveScale(wrapper) {
  if (getStyleSetting("sizeMode") === "adaptive") {
    wrapper.scale.set(1 / (canvas?.stage?.scale?.x || 1));
  } else {
    wrapper.scale.set(1);
  }
}

function buildWrapper(token, text) {
  const wrapper = new PIXI.Container();
  wrapper.eventMode = "none";
  wrapper.zIndex = 10000;

  const badge = new PIXI.Graphics();
  badge.eventMode = "none";

  const label = new (getTextClass())(text, buildTextStyle());
  label.resolution = Math.max(2, window.devicePixelRatio ?? 1);
  label.eventMode = "none";

  layoutLabel(label);
  wrapper.addChild(badge, label);
  drawBadge(badge, label);

  wrapper._uhdBadge = badge;
  wrapper._uhdLabel = label;

  positionWrapper(wrapper, token);
  token.addChild(wrapper);
  return wrapper;
}

/** Можно ли сейчас показывать плашки (включено + условие "только в бою"). */
function isDisplayAllowed() {
  if (!game.settings.get(MODULE_ID, "enabled")) return false;
  if (game.settings.get(MODULE_ID, "combatOnly") && !game.combat?.started) return false;
  return true;
}

function createLabel(token) {
  if (!isDisplayAllowed() || !canvas?.scene) return;

  const text = computeLabelText(token);
  if (!text) return;

  removeLabel(token);
  activeLabels.set(token.id, buildWrapper(token, text));
}

function updateLabel(token) {
  const wrapper = activeLabels.get(token.id);
  if (!wrapper) return;

  const text = computeLabelText(token);
  if (!text) {
    removeLabel(token);
    return;
  }

  const label = wrapper._uhdLabel;
  label.text = text;
  label.style = buildTextStyle();
  layoutLabel(label);
  drawBadge(wrapper._uhdBadge, label);
  positionWrapper(wrapper, token);
}

function removeLabel(token) {
  const wrapper = activeLabels.get(token.id);
  if (!wrapper) return;

  activeLabels.delete(token.id);
  if (!wrapper.destroyed) {
    wrapper.parent?.removeChild(wrapper);
    wrapper.destroy({ children: true });
  }
}

function removeAllLabels() {
  for (const id of Array.from(activeLabels.keys())) {
    const token = canvas.tokens?.get(id);
    if (token) removeLabel(token);
  }
  activeLabels.clear();
}

function refreshAllLabels() {
  for (const id of Array.from(activeLabels.keys())) {
    const token = canvas.tokens?.get(id);
    if (token) updateLabel(token);
  }
}

/** Изменились "включено"/"только в бою" - убираем или восстанавливаем плашки. */
function onVisibilityChange() {
  if (!isDisplayAllowed()) {
    removeAllLabels();
    return;
  }
  const hovered = canvas.tokens?.placeables.find((t) => t.hover);
  if (hovered) createLabel(hovered);
  syncHighlightLabels();
}

/* ------------------------------------------------------------------ */
/*  Показ расстояний до всех (по клавише подсветки, Alt)              */
/* ------------------------------------------------------------------ */

/** Только когда есть ВЫБРАННЫЕ токены (запасной вариант с персонажем не работает). */
function isHighlightModeOn() {
  return highlightActive
    && game.settings.get(MODULE_ID, "altShowAll")
    && isDisplayAllowed()
    && canvas.tokens?.controlled.length > 0;
}

function isHighlightTarget(token) {
  return token.visible && !token.controlled;
}

/** Приводит набор плашек в соответствие с режимом подсветки. */
function syncHighlightLabels() {
  if (!canvas?.tokens) return;
  const on = isHighlightModeOn();
  const wanted = new Set(on ? canvas.tokens.placeables.filter(isHighlightTarget).map((t) => t.id) : []);

  // Убираем лишние (кроме токена под курсором)
  for (const id of Array.from(activeLabels.keys())) {
    const token = canvas.tokens.get(id);
    if (token && !wanted.has(id) && !token.hover) removeLabel(token);
  }
  // Добавляем недостающие
  for (const id of wanted) {
    const token = canvas.tokens.get(id);
    if (token && !activeLabels.has(id)) createLabel(token);
  }
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

Hooks.once("init", registerSettings);

Hooks.on("renderSettingsConfig", (app, html) => decorateSettingsConfig(app, html));

Hooks.on("hoverToken", (token, hovered) => {
  if (hovered) {
    createLabel(token);
    return;
  }
  // В режиме подсветки плашка остаётся и после ухода курсора
  if (isHighlightModeOn() && isHighlightTarget(token)) updateLabel(token);
  else removeLabel(token);
});

Hooks.on("highlightObjects", (active) => {
  highlightActive = !!active;
  syncHighlightLabels();
});

// Живое обновление при движении/анимации/изменении высоты токенов.
Hooks.on("refreshToken", (token) => {
  if (!activeLabels.size) return;

  if (activeLabels.has(token.id)) updateLabel(token);

  // Сдвинулся один из выбранных (опорных) токенов - пересчитываем все плашки.
  if (token.controlled) {
    for (const id of Array.from(activeLabels.keys())) {
      if (id === token.id) continue;
      const other = canvas.tokens.get(id);
      if (other) updateLabel(other);
    }
  }
});

// Смена выделения: пересчитываем плашки и набор целей режима подсветки.
Hooks.on("controlToken", () => {
  refreshAllLabels();
  syncHighlightLabels();
});

// Зум карты - пересчёт масштаба в адаптивном режиме.
Hooks.on("canvasPan", () => {
  for (const wrapper of activeLabels.values()) applyAdaptiveScale(wrapper);
});

// Начало/конец боя - для режима "только в бою".
Hooks.on("updateCombat", () => onVisibilityChange());
Hooks.on("deleteCombat", () => onVisibilityChange());

Hooks.on("deleteToken", (tokenDocument) => {
  const token = tokenDocument.object;
  if (token) removeLabel(token);
});

Hooks.on("canvasReady", () => {
  activeLabels.clear();
  highlightActive = false;
});
