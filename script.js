// Tabby keeps the bill local and shares a portable snapshot through the invite URL.
(() => {
  "use strict";

  const STORAGE_KEY = "tabby.bill.v1";
  const THEME_KEY = "tabby.theme";
  const params = new URLSearchParams(window.location.search);
  const elements = {
    saveStatus: document.getElementById("save-status"),
    themeToggle: document.getElementById("theme-toggle"),
    themeIcon: document.getElementById("theme-icon"),
    themeLabel: document.getElementById("theme-label"),
    dinerForm: document.getElementById("diner-form"),
    dinerName: document.getElementById("diner-name"),
    dinerList: document.getElementById("diner-list"),
    dinerCount: document.getElementById("diner-count"),
    itemForm: document.getElementById("item-form"),
    itemName: document.getElementById("item-name"),
    itemPrice: document.getElementById("item-price"),
    itemQuantity: document.getElementById("item-quantity"),
    itemSubmit: document.getElementById("item-submit"),
    itemError: document.getElementById("item-error"),
    cancelEdit: document.getElementById("cancel-edit"),
    receiptList: document.getElementById("receipt-list"),
    itemCount: document.getElementById("item-count"),
    foodTotal: document.getElementById("food-total"),
    serviceFee: document.getElementById("service-fee"),
    taxFee: document.getElementById("tax-fee"),
    tipFee: document.getElementById("tip-fee"),
    inviteButton: document.getElementById("invite-button"),
    unclaimedCard: document.getElementById("unclaimed-card"),
    unclaimedTitle: document.getElementById("unclaimed-title"),
    unclaimedDetail: document.getElementById("unclaimed-detail"),
    breakdownList: document.getElementById("breakdown-list"),
    totalDue: document.getElementById("total-due"),
    copySummary: document.getElementById("copy-summary"),
    toast: document.getElementById("toast")
  };

  let toastTimer;
  let state = loadInitialState();
  let editingItemId = null;

  function makeId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyState() {
    return { billId: makeId(), diners: [], items: [], fees: { service: 0, tax: 0, tip: 0 } };
  }

  // Shared links use a UTF-8-safe Base64URL snapshot; local storage remains the live bill.
  function normalizeState(candidate) {
    if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.diners) || !Array.isArray(candidate.items)) {
      throw new Error("The shared bill doesn't have a valid format.");
    }

    const fees = candidate.fees && typeof candidate.fees === "object" ? candidate.fees : {};
    const diners = candidate.diners
      .filter((diner) => diner && typeof diner.name === "string")
      .map((diner) => ({ id: String(diner.id || makeId()), name: diner.name.trim().slice(0, 40) }))
      .filter((diner) => diner.name);
    const dinerIds = new Set(diners.map((diner) => diner.id));
    const items = candidate.items
      .filter((item) => item && typeof item.name === "string")
      .map((item) => ({
        id: String(item.id || makeId()),
        name: item.name.trim().slice(0, 80),
        price: Number(item.price),
        quantity: Math.floor(Number(item.quantity)),
        assigned: Array.isArray(item.assigned) ? [...new Set(item.assigned.map(String).filter((id) => dinerIds.has(id)))] : []
      }))
      .filter((item) => item.name && Number.isFinite(item.price) && item.price >= 0 && Number.isFinite(item.quantity) && item.quantity >= 1);

    return {
      billId: String(candidate.billId || makeId()),
      diners,
      items,
      fees: {
        service: safePercent(fees.service),
        tax: safePercent(fees.tax),
        tip: safePercent(fees.tip)
      }
    };
  }

  function safePercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
  }

  function readStoredState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : null;
    } catch (error) {
      showToast(`Saved bill could not be loaded: ${error.message}`);
      return null;
    }
  }

  function loadInitialState() {
    const saved = readStoredState();
    const shared = params.get("bill");
    if (!shared) return saved || emptyState();

    try {
      const decoded = decodePayload(shared);
      const imported = normalizeState(JSON.parse(decoded));
      if (saved && saved.billId === imported.billId) {
        const previousItems = new Map(saved.items.map((item) => [item.id, item.assigned]));
        imported.items.forEach((item) => {
          if (previousItems.has(item.id)) item.assigned = previousItems.get(item.id).filter((id) => imported.diners.some((diner) => diner.id === id));
        });
      }
      return imported;
    } catch (error) {
      window.setTimeout(() => showToast(`Invite link could not be opened: ${error.message}`), 0);
      return saved || emptyState();
    }
  }

  function encodePayload(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodePayload(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.saveStatus.textContent = "Saved on this device";
    } catch (error) {
      elements.saveStatus.textContent = "Not saved";
      showToast(`Could not save this bill: ${error.message}`);
    }
  }

  function money(cents) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
  }

  function cents(value) {
    return Math.round(value * 100);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
  }

  // All food and fee allocations use integer cents so the group total always reconciles.
  function getCalculations() {
    const dinerCents = new Map(state.diners.map((diner) => [diner.id, 0]));
    const itemShares = new Map();
    let unclaimedCents = 0;

    state.items.forEach((item) => {
      const lineCents = cents(item.price * item.quantity);
      const assigned = state.diners.filter((diner) => item.assigned.includes(diner.id));
      if (!assigned.length) {
        unclaimedCents += lineCents;
        itemShares.set(item.id, new Map());
        return;
      }

      const quotient = Math.floor(lineCents / assigned.length);
      let remainder = lineCents - quotient * assigned.length;
      const shares = new Map();
      assigned.forEach((diner) => {
        const share = quotient + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        shares.set(diner.id, share);
        dinerCents.set(diner.id, dinerCents.get(diner.id) + share);
      });
      itemShares.set(item.id, shares);
    });

    const totalFood = [...dinerCents.values()].reduce((sum, amount) => sum + amount, 0);
    const rates = [
      ["service", state.fees.service],
      ["tax", state.fees.tax],
      ["tip", state.fees.tip]
    ];
    const feesByDiner = new Map(state.diners.map((diner) => [diner.id, { service: 0, tax: 0, tip: 0 }]));
    const totalFees = { service: 0, tax: 0, tip: 0 };

    rates.forEach(([feeName, rate]) => {
      const feeCents = Math.round(totalFood * rate / 100);
      totalFees[feeName] = feeCents;
      const allocations = allocateProportionally(feeCents, dinerCents, state.diners.map((diner) => diner.id));
      allocations.forEach((amount, dinerId) => { feesByDiner.get(dinerId)[feeName] = amount; });
    });

    return { dinerCents, itemShares, totalFood, unclaimedCents, feesByDiner, totalFees };
  }

  // Largest-remainder allocation keeps each fee proportional while reconciling to exact cents.
  function allocateProportionally(totalCents, weights, orderedIds) {
    const allocations = new Map(orderedIds.map((id) => [id, 0]));
    const weightTotal = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    if (!totalCents || !weightTotal) return allocations;

    let assignedCents = 0;
    const fractions = orderedIds.map((id, index) => {
      const exact = totalCents * (weights.get(id) || 0) / weightTotal;
      const floor = Math.floor(exact);
      allocations.set(id, floor);
      assignedCents += floor;
      return { id, fraction: exact - floor, index };
    });
    fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < totalCents - assignedCents; index += 1) {
      const id = fractions[index % fractions.length].id;
      allocations.set(id, allocations.get(id) + 1);
    }
    return allocations;
  }

  // Rendering is built with text nodes rather than HTML interpolation for user-entered names.
  function renderDiners() {
    elements.dinerList.replaceChildren();
    elements.dinerCount.textContent = `${state.diners.length} ${state.diners.length === 1 ? "person" : "people"}`;
    if (!state.diners.length) {
      elements.dinerList.append(createElement("p", "empty-state", "No diners yet — add your crew above."));
      return;
    }

    state.diners.forEach((diner) => {
      const chip = createElement("span", "diner-chip");
      chip.append(createElement("span", "", diner.name));
      const remove = createElement("button", "remove-diner", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${diner.name}`);
      remove.dataset.removeDiner = diner.id;
      chip.append(remove);
      elements.dinerList.append(chip);
    });
  }

  function renderItems(calculations) {
    elements.receiptList.replaceChildren();
    elements.itemCount.textContent = `${state.items.length} ${state.items.length === 1 ? "item" : "items"}`;
    elements.foodTotal.textContent = money(state.items.reduce((sum, item) => sum + cents(item.price * item.quantity), 0));
    if (!state.items.length) {
      elements.receiptList.append(createElement("p", "empty-state", "Your receipt is looking deliciously empty. Add the first item above."));
      return;
    }

    state.items.forEach((item) => {
      const card = createElement("article", "receipt-item");
      const top = createElement("div", "receipt-item-top");
      const title = createElement("div", "receipt-item-title");
      title.append(createElement("strong", "", item.name));
      title.append(createElement("small", "", `${item.quantity} × ${money(cents(item.price))}`));
      const total = createElement("span", "receipt-item-total", money(cents(item.price * item.quantity)));
      const actions = createElement("div", "item-actions");
      const edit = createElement("button", "item-action", "Edit");
      edit.type = "button";
      edit.dataset.editItem = item.id;
      edit.setAttribute("aria-label", `Edit ${item.name}`);
      const remove = createElement("button", "item-action delete-item", "Delete");
      remove.type = "button";
      remove.dataset.deleteItem = item.id;
      remove.setAttribute("aria-label", `Delete ${item.name}`);
      actions.append(edit, remove);
      top.append(title, total);
      card.append(top, actions);

      const claimArea = createElement("div", "claim-area");
      claimArea.append(createElement("p", "claim-prompt", state.diners.length ? "Who's sharing this?" : "Add diners above before assigning items."));
      if (state.diners.length) {
        const tags = createElement("div", "claim-tags");
        state.diners.forEach((diner) => {
          const tag = createElement("button", "claim-tag", diner.name);
          tag.type = "button";
          tag.dataset.claimItem = item.id;
          tag.dataset.diner = diner.id;
          tag.setAttribute("aria-pressed", String(item.assigned.includes(diner.id)));
          tag.setAttribute("aria-label", `${item.assigned.includes(diner.id) ? "Remove" : "Add"} ${diner.name} ${item.assigned.includes(diner.id) ? "from" : "to"} ${item.name}`);
          tags.append(tag);
        });
        claimArea.append(tags);
      }
      const selectedNames = state.diners.filter((diner) => item.assigned.includes(diner.id)).map((diner) => diner.name);
      const claimText = selectedNames.length
        ? `Split ${money(cents(item.price * item.quantity))} ${selectedNames.length === 1 ? "with" : "between"} ${selectedNames.join(", ")}`
        : "Unclaimed";
      claimArea.append(createElement("p", selectedNames.length ? "claimed-note" : "claimed-note unclaimed-note", claimText));
      card.append(claimArea);
      elements.receiptList.append(card);
    });
  }

  function renderBreakdown(calculations) {
    elements.breakdownList.replaceChildren();
    const overallTotal = calculations.totalFood + Object.values(calculations.totalFees).reduce((sum, amount) => sum + amount, 0);
    elements.totalDue.textContent = `${money(overallTotal)} total`;

    const totalBase = state.items.reduce((sum, item) => sum + cents(item.price * item.quantity), 0);
    const unclaimedCount = state.items.filter((item) => !item.assigned.length).length;
    elements.unclaimedCard.classList.toggle("is-warning", unclaimedCount > 0);
    elements.unclaimedCard.classList.toggle("is-clear", state.items.length > 0 && unclaimedCount === 0);
    if (!state.items.length) {
      elements.unclaimedTitle.textContent = "Everything claimed";
      elements.unclaimedDetail.textContent = "Add items and diners to get started.";
    } else if (unclaimedCount) {
      elements.unclaimedTitle.textContent = `${unclaimedCount} unclaimed ${unclaimedCount === 1 ? "item" : "items"}`;
      elements.unclaimedDetail.textContent = `${money(calculations.unclaimedCents)} of ${money(totalBase)} still needs a person.`;
    } else {
      elements.unclaimedTitle.textContent = "Everything claimed";
      elements.unclaimedDetail.textContent = "Every item has a place at the table.";
    }

    if (!state.diners.length) {
      elements.breakdownList.append(createElement("p", "no-breakdown", "Add your friends, then tap their names on the items they shared. Their exact totals will show up here."));
      return;
    }

    const colors = ["var(--accent)", "var(--mint)", "var(--rose)", "var(--gold)"];
    state.diners.forEach((diner, index) => {
      const details = createElement("details", "person-breakdown");
      const summary = createElement("summary");
      const personName = createElement("span", "person-name");
      const dot = createElement("span", "person-dot");
      dot.style.backgroundColor = colors[index % colors.length];
      personName.append(dot, createElement("span", "", diner.name));
      const feeParts = calculations.feesByDiner.get(diner.id);
      const food = calculations.dinerCents.get(diner.id);
      const total = food + feeParts.service + feeParts.tax + feeParts.tip;
      summary.append(personName, createElement("strong", "person-total", money(total)));
      details.append(summary);

      const detail = createElement("div", "breakdown-detail");
      const itemLines = createElement("div", "breakdown-items");
      state.items.forEach((item) => {
        const share = calculations.itemShares.get(item.id).get(diner.id);
        if (share === undefined) return;
        itemLines.append(createLine(`${item.name}${item.assigned.length > 1 ? ` · 1 of ${item.assigned.length}` : ""}`, money(share)));
      });
      if (!itemLines.childElementCount) itemLines.append(createLine("No claimed items yet", money(0)));
      detail.append(itemLines);
      const totals = createElement("div", "breakdown-totals");
      totals.append(createLine("Food subtotal", money(food)));
      totals.append(createLine(`Service fee (${formatRate(state.fees.service)}%)`, money(feeParts.service)));
      totals.append(createLine(`Tax / VAT (${formatRate(state.fees.tax)}%)`, money(feeParts.tax)));
      totals.append(createLine(`Tip (${formatRate(state.fees.tip)}%)`, money(feeParts.tip)));
      totals.append(createLine("Grand total", money(total), "breakdown-line grand"));
      detail.append(totals);
      details.append(detail);
      elements.breakdownList.append(details);
    });
  }

  function createLine(label, value, className = "breakdown-line") {
    const line = createElement("div", className);
    line.append(createElement("span", "", label), createElement("span", "", value));
    return line;
  }

  function formatRate(rate) {
    return Number(rate).toString();
  }

  function render() {
    const calculations = getCalculations();
    renderDiners();
    renderItems(calculations);
    renderBreakdown(calculations);
    elements.serviceFee.value = state.fees.service || "";
    elements.taxFee.value = state.fees.tax || "";
    elements.tipFee.value = state.fees.tip || "";
  }

  function updateAndRender() {
    persist();
    render();
  }

  function clearEditMode() {
    editingItemId = null;
    elements.itemForm.reset();
    elements.itemQuantity.value = "1";
    elements.itemSubmit.innerHTML = 'Add to receipt <span aria-hidden="true">↗</span>';
    elements.cancelEdit.classList.add("hidden");
    elements.itemError.textContent = "";
  }

  // Form and receipt events update one state object, then persist and refresh the view.
  elements.dinerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.dinerName.value.trim();
    if (!name) return;
    if (state.diners.some((diner) => diner.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast("That name is already at the table.");
      return;
    }
    state.diners.push({ id: makeId(), name: name.slice(0, 40) });
    elements.dinerForm.reset();
    updateAndRender();
    elements.dinerName.focus();
  });

  elements.itemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.itemName.value.trim();
    const price = Number(elements.itemPrice.value);
    const quantity = Number(elements.itemQuantity.value);
    if (!name || elements.itemPrice.value === "" || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
      elements.itemError.textContent = "Enter an item name, a price of $0 or more, and a whole-number quantity.";
      return;
    }

    if (editingItemId) {
      const item = state.items.find((entry) => entry.id === editingItemId);
      if (item) Object.assign(item, { name: name.slice(0, 80), price, quantity });
    } else {
      state.items.push({ id: makeId(), name: name.slice(0, 80), price, quantity, assigned: [] });
    }
    clearEditMode();
    updateAndRender();
  });

  elements.cancelEdit.addEventListener("click", clearEditMode);
  elements.dinerList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-diner]");
    if (!button) return;
    const dinerId = button.dataset.removeDiner;
    state.diners = state.diners.filter((diner) => diner.id !== dinerId);
    state.items.forEach((item) => { item.assigned = item.assigned.filter((id) => id !== dinerId); });
    updateAndRender();
  });

  elements.receiptList.addEventListener("click", (event) => {
    const claimButton = event.target.closest("[data-claim-item]");
    if (claimButton) {
      const item = state.items.find((entry) => entry.id === claimButton.dataset.claimItem);
      const dinerId = claimButton.dataset.diner;
      if (!item || !state.diners.some((diner) => diner.id === dinerId)) return;
      item.assigned = item.assigned.includes(dinerId)
        ? item.assigned.filter((id) => id !== dinerId)
        : [...item.assigned, dinerId];
      updateAndRender();
      return;
    }

    const editButton = event.target.closest("[data-edit-item]");
    if (editButton) {
      const item = state.items.find((entry) => entry.id === editButton.dataset.editItem);
      if (!item) return;
      editingItemId = item.id;
      elements.itemName.value = item.name;
      elements.itemPrice.value = item.price;
      elements.itemQuantity.value = item.quantity;
      elements.itemSubmit.innerHTML = 'Save changes <span aria-hidden="true">↗</span>';
      elements.cancelEdit.classList.remove("hidden");
      elements.itemError.textContent = "";
      elements.itemName.focus();
      elements.itemForm.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const deleteButton = event.target.closest("[data-delete-item]");
    if (deleteButton) {
      const itemId = deleteButton.dataset.deleteItem;
      state.items = state.items.filter((item) => item.id !== itemId);
      if (editingItemId === itemId) clearEditMode();
      updateAndRender();
    }
  });

  [
    [elements.serviceFee, "service"],
    [elements.taxFee, "tax"],
    [elements.tipFee, "tip"]
  ].forEach(([input, key]) => {
    input.addEventListener("input", () => {
      const value = input.value === "" ? 0 : Number(input.value);
      state.fees[key] = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
      if (Number(input.value) > 100) input.value = "100";
      if (Number(input.value) < 0) input.value = "0";
      persist();
      renderBreakdown(getCalculations());
    });
  });

  elements.inviteButton.addEventListener("click", async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("bill", encodePayload(state));
      await copyText(url.toString());
      showToast("Invite link copied — send it to the group!");
    } catch (error) {
      showToast(`Could not copy the invite link: ${error.message}`);
    }
  });

  elements.copySummary.addEventListener("click", async () => {
    try {
      await copyText(buildSummary());
      showToast("The bill breakdown is ready to paste.");
    } catch (error) {
      showToast(`Could not copy the summary: ${error.message}`);
    }
  });

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) throw new Error("Clipboard access is unavailable in this browser.");
  }

  function buildSummary() {
    const calculations = getCalculations();
    const lines = ["🍽️ Bill split"];
    state.diners.forEach((diner) => {
      const feeParts = calculations.feesByDiner.get(diner.id);
      const food = calculations.dinerCents.get(diner.id);
      const total = food + feeParts.service + feeParts.tax + feeParts.tip;
      lines.push("", `${diner.name} — ${money(total)}`);
      state.items.forEach((item) => {
        const share = calculations.itemShares.get(item.id).get(diner.id);
        if (share !== undefined) lines.push(`  • ${item.name}: ${money(share)}`);
      });
      lines.push(`  Food: ${money(food)}`);
      lines.push(`  Service + tax + tip: ${money(feeParts.service + feeParts.tax + feeParts.tip)}`);
    });
    if (calculations.unclaimedCents > 0) lines.push("", `Unclaimed items: ${money(calculations.unclaimedCents)}`);
    lines.push("", `Group total (claimed): ${money(calculations.totalFood + Object.values(calculations.totalFees).reduce((sum, amount) => sum + amount, 0))}`);
    return lines.join("\n");
  }

  elements.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      showToast(`Theme changed, but couldn't save the preference: ${error.message}`);
    }
  });

  function applyTheme(theme) {
    const isLight = theme === "light";
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
    elements.themeToggle.setAttribute("aria-pressed", String(isLight));
    elements.themeToggle.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} theme`);
    elements.themeIcon.textContent = isLight ? "☾" : "☀";
    elements.themeLabel.textContent = isLight ? "Dark mode" : "Light mode";
    document.querySelector('meta[name="theme-color"]').content = isLight ? "#fffdf5" : "#1e1b24";
  }

  function loadTheme() {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      applyTheme(savedTheme === "light" ? "light" : "dark");
    } catch (error) {
      applyTheme("dark");
      showToast(`Theme preference couldn't be loaded: ${error.message}`);
    }
  }

  loadTheme();
  render();
})();
