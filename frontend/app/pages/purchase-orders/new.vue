<script setup lang="ts">
import { getFetchErrorMessage } from '~/utils/fetch-error'
import { trackEvent } from '~/utils/analytics'
import StatCard from '~/components/common/StatCard.vue'
import type { Ingredient, PurchaseOrderStatus, Supplier } from '~/types/business'
import { useIngredientStore } from '~/stores/ingredients'
import { usePurchaseOrderStore } from '~/stores/purchase-orders'
import { useSupplierStore } from '~/stores/suppliers'

definePageMeta({
  middleware: 'manager'
})

type PurchaseStep = 'forecast' | 'selection' | 'cart' | 'checkout'

type CartLine = {
  ingredientId: string
  ingredientName: string
  category: Ingredient['category']
  supplierId: string
  supplierName: string
  unit: Ingredient['unit']
  orderUnit: Ingredient['unit']
  quantity: number
  unitPrice: number
  stockQuantity: number
  minimumStock: number
  averageDailyUsage: number
  minimumOrderQuantity: number
  recommendedQuantity: number
}

type ForecastLine = {
  ingredient: Ingredient
  supplierId: string
  supplierName: string
  forecastNeed: number
  recommendedQuantity: number
  projectedStock: number
  lowStock: boolean
}

const VAT_RATE = 0.1
const DEFAULT_DELIVERY_ADDRESS = 'Restaurant Eat Planner, 12 rue des Chefs, 75002 Paris'

const stepItems: Array<{ key: PurchaseStep, label: string, icon: string }> = [
  { key: 'forecast', label: 'Prevision', icon: 'i-lucide-chart-no-axes-combined' },
  { key: 'selection', label: 'Selection', icon: 'i-lucide-list-plus' },
  { key: 'cart', label: 'Panier', icon: 'i-lucide-shopping-cart' },
  { key: 'checkout', label: 'Validation', icon: 'i-lucide-clipboard-check' }
]

const supplierStore = useSupplierStore()
const ingredientStore = useIngredientStore()
const purchaseOrderStore = usePurchaseOrderStore()
const appToast = useAppToast()
const { roundMoney, formatCurrency, formatQuantity, formatDate } = usePurchaseHelpers()

const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const activeStep = ref<PurchaseStep>('forecast')
const forecastHorizon = ref<3 | 7>(7)
const cartLines = ref<CartLine[]>([])
const deliveryAddress = ref(DEFAULT_DELIVERY_ADDRESS)
const internalComment = ref('')

const ingredientFilters = reactive({
  search: '',
  supplier: 'all',
  category: 'all',
  stock: 'all'
})

const activeSuppliers = computed(() => supplierStore.items.filter(supplier => supplier.active))
const activeIngredients = computed(() => ingredientStore.items.filter(ingredient => ingredient.active))
const ingredientCategories = computed(() =>
  [...new Set(activeIngredients.value.map(ingredient => ingredient.category))]
)

const forecastLines = computed<ForecastLine[]>(() =>
  activeIngredients.value.map((ingredient) => {
    const recommendedQuantity = getRecommendedQuantity(ingredient, forecastHorizon.value)
    const forecastNeed = (ingredient.averageDailyUsage || 0) * forecastHorizon.value
    return {
      ingredient,
      supplierId: getIngredientSupplierId(ingredient),
      supplierName: getIngredientSupplierName(ingredient),
      forecastNeed,
      recommendedQuantity,
      projectedStock: Math.max(0, (ingredient.stockQuantity || 0) - forecastNeed),
      lowStock: (ingredient.stockQuantity || 0) <= (ingredient.minimumStock || 0)
    }
  })
)

const filteredForecastLines = computed(() => {
  const search = ingredientFilters.search.trim().toLowerCase()

  return forecastLines.value.filter((line) => {
    const searchableText = [
      line.ingredient.name,
      line.ingredient.category,
      line.supplierName,
      line.ingredient.unit
    ].filter(Boolean).join(' ').toLowerCase()

    const matchesSearch = !search || searchableText.includes(search)
    const matchesSupplier = ingredientFilters.supplier === 'all' || line.supplierId === ingredientFilters.supplier
    const matchesCategory = ingredientFilters.category === 'all' || line.ingredient.category === ingredientFilters.category
    const matchesStock = ingredientFilters.stock === 'all'
      || (ingredientFilters.stock === 'low' && line.recommendedQuantity > 0)
      || (ingredientFilters.stock === 'critical' && line.lowStock)

    return matchesSearch && matchesSupplier && matchesCategory && matchesStock
  })
})

const reorderLines = computed(() => forecastLines.value.filter(line => line.recommendedQuantity > 0))
const criticalLines = computed(() => forecastLines.value.filter(line => line.lowStock))
const forecastBudget = computed(() =>
  reorderLines.value.reduce((sum, line) => sum + line.recommendedQuantity * line.ingredient.purchasePrice, 0)
)

const cartSubtotal = computed(() =>
  cartLines.value.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
)

const selectedSuppliers = computed(() => {
  const supplierIds = [...new Set(cartLines.value.map(line => line.supplierId).filter(Boolean))]
  return supplierIds
    .map(id => supplierStore.items.find(supplier => supplier._id === id))
    .filter((supplier): supplier is Supplier => Boolean(supplier))
})

const deliveryFees = computed(() =>
  selectedSuppliers.value.reduce((sum, supplier) => sum + (supplier.deliveryFee || 0), 0)
)

const cartTotalExclTax = computed(() => roundMoney(cartSubtotal.value + deliveryFees.value))
const cartVatAmount = computed(() => roundMoney(cartTotalExclTax.value * VAT_RATE))
const cartTotalInclTax = computed(() => roundMoney(cartTotalExclTax.value + cartVatAmount.value))
const cartLineCount = computed(() => cartLines.value.length)
const primarySupplierId = computed(() => cartLines.value[0]?.supplierId || activeSuppliers.value[0]?._id || '')
const canCreateOrder = computed(() =>
  cartLines.value.length > 0
  && Boolean(primarySupplierId.value)
  && cartLines.value.every(line => line.quantity > 0 && line.unitPrice >= 0)
)

const supplierMinimumAlerts = computed(() =>
  selectedSuppliers.value
    .map((supplier) => {
      const amount = cartLines.value
        .filter(line => line.supplierId === supplier._id)
        .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)

      return {
        supplier,
        amount,
        missing: Math.max(0, (supplier.minimumOrderAmount || 0) - amount)
      }
    })
    .filter(item => item.missing > 0)
)

const excessiveCartLines = computed(() =>
  cartLines.value.filter(line => line.recommendedQuantity > 0 && line.quantity > line.recommendedQuantity * 1.75)
)

const estimatedDeliveryDate = computed(() => {
  const maxLeadTime = selectedSuppliers.value.reduce((max, supplier) => Math.max(max, supplier.deliveryLeadTimeDays || 0), 0)
  return addDaysIso(maxLeadTime || 2)
})

const stats = computed(() => [
  { title: 'A reapprovisionner', value: reorderLines.value.length, hint: `${criticalLines.value.length} sous le seuil` },
  { title: 'Budget previsionnel', value: formatCurrency(forecastBudget.value), hint: `${forecastHorizon.value} jours de besoins` },
  { title: 'Panier TTC', value: formatCurrency(cartTotalInclTax.value), hint: `${cartLineCount.value} ligne(s)` }
])

const activeStepIndex = computed(() => stepItems.findIndex(step => step.key === activeStep.value))

function stepState(key: PurchaseStep): 'done' | 'active' | 'todo' {
  const index = stepItems.findIndex(step => step.key === key)
  if (index < activeStepIndex.value) {
    return 'done'
  }
  if (index === activeStepIndex.value) {
    return 'active'
  }
  return 'todo'
}

function stepMarkerClass(key: PurchaseStep) {
  const state = stepState(key)
  if (state === 'done') {
    return 'border-transparent bg-[color:var(--ep-primary)] text-white'
  }
  if (state === 'active') {
    return 'border-transparent bg-[#feb236] text-[#6d4700] shadow-sm ring-4 ring-[#feb236]/25'
  }
  return 'border-[color:var(--ep-border-strong)] bg-[color:var(--ep-surface-muted)] text-[color:var(--ep-text-muted)]'
}

async function loadPage() {
  loading.value = true
  errorMessage.value = ''

  try {
    const results = await Promise.allSettled([
      supplierStore.load(),
      ingredientStore.load()
    ])

    const firstFailure = results.find(result => result.status === 'rejected')

    if (firstFailure?.status === 'rejected') {
      errorMessage.value = getFetchErrorMessage(firstFailure.reason, 'Impossible de charger le catalogue achat')
      appToast.error('Chargement partiel', errorMessage.value)
    }
  } catch (error) {
    errorMessage.value = getFetchErrorMessage(error, 'Impossible de charger le catalogue achat')
    appToast.error('Chargement impossible', errorMessage.value)
  } finally {
    loading.value = false
  }
}

function addDaysIso(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function getIngredientSupplierId(item: Ingredient) {
  if (!item.supplier) {
    return ''
  }

  return typeof item.supplier === 'object' ? item.supplier._id : item.supplier
}

function getIngredientSupplierName(item: Ingredient) {
  if (!item.supplier) {
    return 'Sans fournisseur'
  }

  if (typeof item.supplier === 'object') {
    return item.supplier.name
  }

  return supplierStore.items.find(supplier => supplier._id === item.supplier)?.name ?? 'Fournisseur'
}

function getRecommendedQuantity(ingredient: Ingredient, days: number) {
  const need = (ingredient.averageDailyUsage || 0) * days + (ingredient.minimumStock || 0) - (ingredient.stockQuantity || 0)
  if (need <= 0) {
    return 0
  }

  return Math.max(Math.ceil(need), ingredient.minimumOrderQuantity || 0)
}

function addIngredientToCart(ingredient: Ingredient, quantity = getRecommendedQuantity(ingredient, forecastHorizon.value)) {
  const supplierId = getIngredientSupplierId(ingredient)
  if (!supplierId) {
    appToast.warning('Fournisseur manquant', `${ingredient.name} doit etre relie a un fournisseur avant commande.`)
    return
  }

  const safeQuantity = Math.max(quantity || ingredient.minimumOrderQuantity || 1, ingredient.minimumOrderQuantity || 0.01)

  // Tunnel de conversion : etape 2 (add_to_cart). Chaque ajout est trace, y
  // compris quand on incremente une ligne deja presente au panier.
  trackEvent('add_to_cart', {
    produit: ingredient.name,
    categorie: ingredient.category,
    fournisseur: getIngredientSupplierName(ingredient),
    quantite: roundMoney(safeQuantity),
    prix_unitaire: ingredient.purchasePrice
  })

  const existing = cartLines.value.find(line => line.ingredientId === ingredient._id)

  if (existing) {
    existing.quantity = roundMoney(existing.quantity + safeQuantity)
    return
  }

  cartLines.value.push({
    ingredientId: ingredient._id,
    ingredientName: ingredient.name,
    category: ingredient.category,
    supplierId,
    supplierName: getIngredientSupplierName(ingredient),
    unit: ingredient.unit,
    orderUnit: ingredient.orderUnit || ingredient.unit,
    quantity: roundMoney(safeQuantity),
    unitPrice: ingredient.purchasePrice,
    stockQuantity: ingredient.stockQuantity || 0,
    minimumStock: ingredient.minimumStock || 0,
    averageDailyUsage: ingredient.averageDailyUsage || 0,
    minimumOrderQuantity: ingredient.minimumOrderQuantity || 0,
    recommendedQuantity: getRecommendedQuantity(ingredient, forecastHorizon.value)
  })
}

function addReplenishmentLines(criticalOnly = false) {
  const candidates = forecastLines.value.filter(line =>
    line.recommendedQuantity > 0 && (!criticalOnly || line.lowStock)
  )

  candidates.forEach(line => addIngredientToCart(line.ingredient, line.recommendedQuantity))
  activeStep.value = 'cart'
  appToast.success('Panier mis a jour', `${candidates.length} ingredient(s) ajoute(s) avec les quantites recommandees.`)
}

function applyRecommendedQuantities() {
  cartLines.value.forEach((line) => {
    if (line.recommendedQuantity > 0) {
      line.quantity = line.recommendedQuantity
    }
  })
  appToast.info('Quantites recalees', 'Le panier suit maintenant les recommandations de prevision.')
}

function removeCartLine(ingredientId: string) {
  cartLines.value = cartLines.value.filter(line => line.ingredientId !== ingredientId)
}

function clearCart() {
  cartLines.value = []
  internalComment.value = ''
}

function buildOrderPayload(status: PurchaseOrderStatus) {
  return {
    supplier: primarySupplierId.value,
    deliveryAddress: deliveryAddress.value,
    internalComment: internalComment.value,
    estimatedDeliveryDate: estimatedDeliveryDate.value,
    notes: internalComment.value,
    status,
    vatRate: VAT_RATE,
    items: cartLines.value.map(line => ({
      ingredient: line.ingredientId,
      quantity: Number(line.quantity),
      unit: line.unit,
      unitPrice: Number(line.unitPrice),
      recommendedQuantity: line.recommendedQuantity
    }))
  }
}

async function saveDraftOrder() {
  if (!canCreateOrder.value || saving.value) {
    return
  }

  saving.value = true
  try {
    const order = await purchaseOrderStore.create(buildOrderPayload('draft'))
    trackEvent('commande-creee', {
      statut: 'brouillon',
      montant: cartTotalInclTax.value,
      fournisseur: selectedSuppliers.value.map(supplier => supplier.name).join(', '),
      lignes: cartLineCount.value
    })
    appToast.success('Brouillon sauvegarde', `Commande ${order.orderNumber || ''} conservee dans les commandes.`)
    await navigateTo('/purchase-orders')
  } catch (error) {
    errorMessage.value = getFetchErrorMessage(error, 'Impossible de sauvegarder le panier')
    appToast.error('Sauvegarde impossible', errorMessage.value)
  } finally {
    saving.value = false
  }
}

async function validateOrder() {
  if (!canCreateOrder.value || saving.value) {
    return
  }

  saving.value = true
  try {
    const order = await purchaseOrderStore.create(buildOrderPayload('pending_payment'))
    trackEvent('commande-creee', {
      statut: 'validee',
      montant: cartTotalInclTax.value,
      fournisseur: selectedSuppliers.value.map(supplier => supplier.name).join(', '),
      lignes: cartLineCount.value
    })
    appToast.success('Commande validee', `Commande ${order.orderNumber || ''} prete a etre payee.`)
    await navigateTo(`/purchase-orders?pay=${order._id}`)
  } catch (error) {
    errorMessage.value = getFetchErrorMessage(error, 'Impossible de valider la commande')
    appToast.error('Validation impossible', errorMessage.value)
  } finally {
    saving.value = false
  }
}

function resetIngredientFilters() {
  ingredientFilters.search = ''
  ingredientFilters.supplier = 'all'
  ingredientFilters.category = 'all'
  ingredientFilters.stock = 'all'
}

// Tunnel de conversion : etapes 1 (view_product) et 3 (checkout_start).
// On observe le changement d'etape de l'assistant plutot que d'instrumenter
// chaque bouton, pour capter aussi les navigations via la barre d'etapes.
watch(activeStep, (step) => {
  if (step === 'selection') {
    trackEvent('view_product', {
      catalogue: 'ingredients',
      produits_visibles: filteredForecastLines.value.length
    })
  } else if (step === 'checkout') {
    trackEvent('checkout_start', {
      lignes: cartLineCount.value,
      montant: cartTotalInclTax.value,
      fournisseurs: selectedSuppliers.value.map(supplier => supplier.name).join(', ')
    })
  }
})

onMounted(loadPage)
</script>

<template>
  <div class="space-y-5">
    <section class="app-page-header app-page-header--compact">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="app-eyebrow">
            Achats fournisseur
          </p>
          <h1 class="app-title mt-2">
            Nouvel achat
          </h1>
          <p class="app-subtitle mt-2">
            Prevision des besoins, panier fournisseur puis validation. Le paiement se fait ensuite depuis la liste des commandes.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <NuxtLink
            to="/purchase-orders"
            class="btn-secondary"
          >
            <UIcon
              name="i-lucide-arrow-left"
              class="size-4"
            />
            Commandes
          </NuxtLink>
          <button
            type="button"
            class="btn-primary"
            @click="addReplenishmentLines(true)"
          >
            <UIcon
              name="i-lucide-wand-sparkles"
              class="size-4"
            />
            Ajouter stock bas
          </button>
        </div>
      </div>
    </section>

    <p
      v-if="errorMessage"
      class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
    >
      {{ errorMessage }}
    </p>

    <template v-if="loading">
      <div class="grid gap-3 md:grid-cols-3">
        <div
          v-for="index in 3"
          :key="index"
          class="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800"
        />
      </div>
    </template>

    <template v-else>
      <div class="grid gap-3 md:grid-cols-3">
        <StatCard
          v-for="stat in stats"
          :key="stat.title"
          :title="stat.title"
          :value="stat.value"
          :hint="stat.hint"
        />
      </div>

      <section class="app-section">
        <div class="overflow-x-auto pb-1">
          <div class="flex min-w-max items-center gap-1">
            <template
              v-for="(step, index) in stepItems"
              :key="step.key"
            >
              <button
                type="button"
                class="flex shrink-0 flex-col items-center gap-1.5 px-1"
                @click="activeStep = step.key"
              >
                <span
                  class="flex size-9 items-center justify-center rounded-lg border transition"
                  :class="stepMarkerClass(step.key)"
                >
                  <UIcon
                    :name="stepState(step.key) === 'done' ? 'i-lucide-check' : step.icon"
                    class="size-4"
                  />
                </span>
                <span
                  class="text-xs font-semibold transition"
                  :class="stepState(step.key) === 'todo'
                    ? 'text-[color:var(--ep-text-subtle)]'
                    : 'text-[color:var(--ep-text)]'"
                >
                  {{ step.label }}
                </span>
              </button>
              <span
                v-if="index < stepItems.length - 1"
                class="mb-5 h-0.5 w-10 shrink-0 rounded-full transition sm:w-16"
                :class="index < activeStepIndex
                  ? 'bg-[color:var(--ep-primary)]'
                  : 'bg-[color:var(--ep-border-strong)]'"
              />
            </template>
          </div>
        </div>
      </section>

      <section
        v-if="activeStep === 'forecast'"
        class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"
      >
        <div class="app-section">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p class="app-eyebrow">
                Prevision des besoins
              </p>
              <h2 class="app-section-title mt-1">
                Quantites recommandees avant achat
              </h2>
              <p class="mt-2 text-sm leading-6 text-[#40493e] dark:text-[#c0c9ba]">
                Recommandation = consommation moyenne par jour x horizon + seuil minimum - stock actuel, en respectant le minimum de commande fournisseur.
              </p>
            </div>
            <div class="flex rounded-md border border-[#c0c9ba]/30 p-1 dark:border-white/10">
              <button
                type="button"
                class="rounded px-3 py-1.5 text-sm font-semibold"
                :class="forecastHorizon === 3 ? 'bg-[#feb236] text-[#6d4700]' : 'text-[#40493e] dark:text-[#c0c9ba]'"
                @click="forecastHorizon = 3"
              >
                3 jours
              </button>
              <button
                type="button"
                class="rounded px-3 py-1.5 text-sm font-semibold"
                :class="forecastHorizon === 7 ? 'bg-[#feb236] text-[#6d4700]' : 'text-[#40493e] dark:text-[#c0c9ba]'"
                @click="forecastHorizon = 7"
              >
                7 jours
              </button>
            </div>
          </div>

          <div class="mt-4 grid gap-3 md:grid-cols-4">
            <div class="app-inset">
              <p class="text-xs font-semibold uppercase text-[#40493e] dark:text-[#c0c9ba]">
                Stock bas
              </p>
              <p class="mt-1 text-2xl font-bold text-[#1a1c1c] dark:text-white">
                {{ criticalLines.length }}
              </p>
            </div>
            <div class="app-inset">
              <p class="text-xs font-semibold uppercase text-[#40493e] dark:text-[#c0c9ba]">
                A commander
              </p>
              <p class="mt-1 text-2xl font-bold text-[#1a1c1c] dark:text-white">
                {{ reorderLines.length }}
              </p>
            </div>
            <div class="app-inset md:col-span-2">
              <p class="text-xs font-semibold uppercase text-[#40493e] dark:text-[#c0c9ba]">
                Budget recommande
              </p>
              <p class="mt-1 text-2xl font-bold text-[#1a1c1c] dark:text-white">
                {{ formatCurrency(forecastBudget) }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn-primary"
              @click="addReplenishmentLines(false)"
            >
              Commander les quantites recommandees
            </button>
            <button
              type="button"
              class="btn-secondary"
              @click="addReplenishmentLines(true)"
            >
              Ajouter les ingredients critiques
            </button>
            <button
              type="button"
              class="btn-secondary"
              @click="activeStep = 'selection'"
            >
              Choisir manuellement
            </button>
          </div>
        </div>

        <div class="app-section">
          <p class="app-eyebrow">
            Comment ca marche
          </p>
          <h2 class="app-section-title mt-1">
            3 etapes avant paiement
          </h2>
          <div class="mt-4 grid gap-3">
            <div class="app-inset">
              <p class="text-sm leading-6 text-[#1a1c1c] dark:text-white">
                1. La prevision propose les quantites a racheter selon ton stock et ta consommation.
              </p>
            </div>
            <div class="app-inset">
              <p class="text-sm leading-6 text-[#1a1c1c] dark:text-white">
                2. Tu ajustes le panier fournisseur (quantites, prix), puis tu valides la commande.
              </p>
            </div>
            <div class="app-inset">
              <p class="text-sm leading-6 text-[#1a1c1c] dark:text-white">
                3. La commande apparait dans "Commandes & paiements" ou tu payes le fournisseur par virement.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="activeStep === 'selection'"
        class="app-section"
      >
        <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="app-eyebrow">
              Catalogue fournisseur
            </p>
            <h2 class="app-section-title mt-1">
              Ingredients disponibles a l achat
            </h2>
          </div>
          <span class="app-pill">{{ filteredForecastLines.length }} / {{ forecastLines.length }} ligne(s)</span>
        </div>

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <input
            v-model="ingredientFilters.search"
            class="app-input"
            type="search"
            placeholder="Rechercher ingredient, categorie, fournisseur"
            aria-label="Rechercher un ingredient"
          >
          <select
            v-model="ingredientFilters.supplier"
            class="app-input"
            aria-label="Filtrer par fournisseur"
          >
            <option value="all">
              Tous fournisseurs
            </option>
            <option
              v-for="supplier in activeSuppliers"
              :key="supplier._id"
              :value="supplier._id"
            >
              {{ supplier.name }}
            </option>
          </select>
          <select
            v-model="ingredientFilters.category"
            class="app-input"
            aria-label="Filtrer par categorie"
          >
            <option value="all">
              Toutes categories
            </option>
            <option
              v-for="category in ingredientCategories"
              :key="category"
              :value="category"
            >
              {{ category }}
            </option>
          </select>
          <select
            v-model="ingredientFilters.stock"
            class="app-input"
            aria-label="Filtrer par besoin"
          >
            <option value="all">
              Tous besoins
            </option>
            <option value="low">
              Avec quantite recommandee
            </option>
            <option value="critical">
              Stock sous seuil
            </option>
          </select>
          <button
            type="button"
            class="btn-secondary"
            @click="resetIngredientFilters"
          >
            Reset
          </button>
        </div>

        <div class="mt-4 overflow-x-auto rounded-lg border border-[#c0c9ba]/30 dark:border-white/10">
          <table class="min-w-full divide-y divide-[#c0c9ba]/30 text-sm dark:divide-white/10">
            <thead class="bg-[#f3f3f3] dark:bg-[#2f3131]/60">
              <tr>
                <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                  Ingredient
                </th>
                <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                  Fournisseur
                </th>
                <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                  Stock
                </th>
                <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                  Besoin {{ forecastHorizon }}j
                </th>
                <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                  Recommande
                </th>
                <th class="px-3 py-2 text-right font-medium text-[#40493e]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#c0c9ba]/30 bg-white dark:divide-white/10 dark:bg-[#1a1c1c]">
              <tr
                v-for="line in filteredForecastLines"
                :key="line.ingredient._id"
              >
                <td class="px-3 py-3">
                  <p class="font-semibold text-[#1a1c1c] dark:text-white">
                    {{ line.ingredient.name }}
                  </p>
                  <p class="text-xs text-[#40493e] dark:text-[#c0c9ba]">
                    {{ line.ingredient.category }} - {{ formatCurrency(line.ingredient.purchasePrice) }} / {{ line.ingredient.unit }}
                  </p>
                </td>
                <td class="px-3 py-3 text-[#1a1c1c] dark:text-white">
                  {{ line.supplierName }}
                </td>
                <td
                  class="px-3 py-3 font-medium"
                  :class="line.lowStock ? 'text-amber-700 dark:text-amber-300' : 'text-[#1a1c1c] dark:text-white'"
                >
                  {{ formatQuantity(line.ingredient.stockQuantity, line.ingredient.unit) }}
                  <span class="block text-xs font-normal text-[#40493e] dark:text-[#c0c9ba]">
                    seuil {{ formatQuantity(line.ingredient.minimumStock, line.ingredient.unit) }}
                  </span>
                </td>
                <td class="px-3 py-3">
                  {{ formatQuantity(line.forecastNeed, line.ingredient.unit) }}
                </td>
                <td class="px-3 py-3 font-semibold text-[#1a1c1c] dark:text-white">
                  {{ formatQuantity(line.recommendedQuantity, line.ingredient.unit) }}
                </td>
                <td class="px-3 py-3 text-right">
                  <button
                    type="button"
                    class="btn-secondary px-3 py-1.5"
                    @click="addIngredientToCart(line.ingredient, line.recommendedQuantity)"
                  >
                    <UIcon
                      name="i-lucide-plus"
                      class="size-4"
                    />
                    Ajouter
                  </button>
                </td>
              </tr>
              <tr v-if="filteredForecastLines.length === 0">
                <td
                  colspan="6"
                  class="px-3 py-8 text-center text-sm text-[#40493e] dark:text-[#c0c9ba]"
                >
                  Aucun ingredient ne correspond aux filtres.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="btn-primary"
            :disabled="cartLines.length === 0"
            @click="activeStep = 'cart'"
          >
            Voir le panier ({{ cartLineCount }})
          </button>
        </div>
      </section>

      <section
        v-if="activeStep === 'cart'"
        class="grid gap-4 xl:grid-cols-[1fr_0.36fr]"
      >
        <div class="app-section">
          <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="app-eyebrow">
                Panier fournisseur
              </p>
              <h2 class="app-section-title mt-1">
                Commande d approvisionnement
              </h2>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn-secondary"
                :disabled="cartLines.length === 0"
                @click="applyRecommendedQuantities"
              >
                Recaler sur recommande
              </button>
              <button
                type="button"
                class="btn-secondary"
                :disabled="cartLines.length === 0"
                @click="clearCart"
              >
                Vider
              </button>
            </div>
          </div>

          <div class="overflow-x-auto rounded-lg border border-[#c0c9ba]/30 dark:border-white/10">
            <table class="min-w-full divide-y divide-[#c0c9ba]/30 text-sm dark:divide-white/10">
              <thead class="bg-[#f3f3f3] dark:bg-[#2f3131]/60">
                <tr>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Ingredient
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Fournisseur
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Reco
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Quantite
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Prix
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-[#40493e]">
                    Total
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-[#40493e]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#c0c9ba]/30 bg-white dark:divide-white/10 dark:bg-[#1a1c1c]">
                <tr
                  v-for="line in cartLines"
                  :key="line.ingredientId"
                >
                  <td class="px-3 py-3">
                    <p class="font-semibold text-[#1a1c1c] dark:text-white">
                      {{ line.ingredientName }}
                    </p>
                    <p class="text-xs text-[#40493e] dark:text-[#c0c9ba]">
                      {{ line.category }} - {{ line.orderUnit }}
                    </p>
                  </td>
                  <td class="px-3 py-3 text-[#1a1c1c] dark:text-white">
                    {{ line.supplierName }}
                  </td>
                  <td class="px-3 py-3 font-semibold text-[#1a1c1c] dark:text-white">
                    {{ formatQuantity(line.recommendedQuantity, line.unit) }}
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model.number="line.quantity"
                      class="app-input max-w-28 py-1.5"
                      type="number"
                      min="0.01"
                      step="0.01"
                      aria-label="Quantite ligne panier"
                    >
                    <p
                      v-if="line.recommendedQuantity > 0 && line.quantity > line.recommendedQuantity * 1.75"
                      class="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
                    >
                      Quantite excessive
                    </p>
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model.number="line.unitPrice"
                      class="app-input max-w-28 py-1.5"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label="Prix unitaire ligne panier"
                    >
                  </td>
                  <td class="px-3 py-3 text-right font-semibold">
                    {{ formatCurrency(line.quantity * line.unitPrice) }}
                  </td>
                  <td class="px-3 py-3 text-right">
                    <button
                      type="button"
                      class="btn-danger px-3 py-1.5"
                      @click="removeCartLine(line.ingredientId)"
                    >
                      <UIcon
                        name="i-lucide-trash-2"
                        class="size-4"
                      />
                    </button>
                  </td>
                </tr>
                <tr v-if="cartLines.length === 0">
                  <td
                    colspan="7"
                    class="px-3 py-8 text-center text-sm text-[#40493e] dark:text-[#c0c9ba]"
                  >
                    Le panier est vide. Passe par la prevision ou la selection pour ajouter des ingredients.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="excessiveCartLines.length > 0 || supplierMinimumAlerts.length > 0"
            class="mt-4 grid gap-2"
          >
            <div
              v-for="alert in supplierMinimumAlerts"
              :key="alert.supplier._id"
              class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              Minimum {{ alert.supplier.name }} non atteint: il manque {{ formatCurrency(alert.missing) }}.
            </div>
            <div
              v-if="excessiveCartLines.length > 0"
              class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              {{ excessiveCartLines.length }} ligne(s) depassent fortement le besoin estime.
            </div>
          </div>
        </div>

        <aside class="app-section h-fit">
          <p class="app-eyebrow">
            Resume commande
          </p>
          <h2 class="app-section-title mt-1">
            Totaux fournisseur
          </h2>
          <div class="mt-4 grid gap-2 text-sm">
            <div class="flex justify-between gap-3">
              <span class="text-[#40493e] dark:text-[#c0c9ba]">Articles HT</span>
              <span class="font-semibold">{{ formatCurrency(cartSubtotal) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-[#40493e] dark:text-[#c0c9ba]">Frais livraison</span>
              <span class="font-semibold">{{ formatCurrency(deliveryFees) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-[#40493e] dark:text-[#c0c9ba]">TVA 10%</span>
              <span class="font-semibold">{{ formatCurrency(cartVatAmount) }}</span>
            </div>
            <div class="border-t border-[#c0c9ba]/30 pt-3 text-base dark:border-white/10">
              <div class="flex justify-between gap-3">
                <span class="font-semibold">Total TTC</span>
                <span class="font-bold">{{ formatCurrency(cartTotalInclTax) }}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            class="btn-primary mt-4 w-full"
            :disabled="!canCreateOrder"
            @click="activeStep = 'checkout'"
          >
            Passer a la validation
          </button>
        </aside>
      </section>

      <section
        v-if="activeStep === 'checkout'"
        class="grid gap-4 xl:grid-cols-[1fr_0.4fr]"
      >
        <div class="app-section">
          <p class="app-eyebrow">
            Validation commande
          </p>
          <h2 class="app-section-title mt-1">
            Verifier avant de valider
          </h2>

          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div class="app-inset">
              <p class="text-xs font-semibold uppercase text-[#40493e] dark:text-[#c0c9ba]">
                Fournisseurs
              </p>
              <p class="mt-1 font-semibold text-[#1a1c1c] dark:text-white">
                {{ selectedSuppliers.map(supplier => supplier.name).join(', ') || '-' }}
              </p>
            </div>
            <div class="app-inset">
              <p class="text-xs font-semibold uppercase text-[#40493e] dark:text-[#c0c9ba]">
                Livraison estimee
              </p>
              <p class="mt-1 font-semibold text-[#1a1c1c] dark:text-white">
                {{ formatDate(estimatedDeliveryDate) }}
              </p>
            </div>
          </div>

          <div class="mt-4 grid gap-3">
            <textarea
              v-model="deliveryAddress"
              class="app-input min-h-24"
              placeholder="Adresse de livraison du restaurant"
            />
            <textarea
              v-model="internalComment"
              class="app-input min-h-24"
              placeholder="Commentaire interne: service, priorite, consigne fournisseur"
            />
          </div>

          <div class="mt-4 overflow-x-auto rounded-lg border border-[#c0c9ba]/30 dark:border-white/10">
            <table class="min-w-full divide-y divide-[#c0c9ba]/30 text-sm dark:divide-white/10">
              <thead class="bg-[#f3f3f3] dark:bg-[#2f3131]/60">
                <tr>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Article
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Fournisseur
                  </th>
                  <th class="px-3 py-2 text-left font-medium text-[#40493e]">
                    Quantite
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-[#40493e]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#c0c9ba]/30 bg-white dark:divide-white/10 dark:bg-[#1a1c1c]">
                <tr
                  v-for="line in cartLines"
                  :key="line.ingredientId"
                >
                  <td class="px-3 py-2 font-medium">
                    {{ line.ingredientName }}
                  </td>
                  <td class="px-3 py-2">
                    {{ line.supplierName }}
                  </td>
                  <td class="px-3 py-2">
                    {{ formatQuantity(line.quantity, line.unit) }}
                  </td>
                  <td class="px-3 py-2 text-right font-semibold">
                    {{ formatCurrency(line.quantity * line.unitPrice) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="app-section h-fit">
          <p class="app-eyebrow">
            Totaux
          </p>
          <div class="mt-3 grid gap-2 text-sm">
            <div class="flex justify-between gap-3">
              <span class="text-[#40493e] dark:text-[#c0c9ba]">Total HT</span>
              <span class="font-semibold">{{ formatCurrency(cartTotalExclTax) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-[#40493e] dark:text-[#c0c9ba]">TVA</span>
              <span class="font-semibold">{{ formatCurrency(cartVatAmount) }}</span>
            </div>
            <div class="flex justify-between gap-3 text-base">
              <span class="font-semibold">Total TTC</span>
              <span class="font-bold">{{ formatCurrency(cartTotalInclTax) }}</span>
            </div>
          </div>
          <button
            type="button"
            class="btn-primary mt-4 w-full"
            :disabled="!canCreateOrder || saving"
            @click="validateOrder"
          >
            {{ saving ? 'Validation...' : 'Valider la commande' }}
          </button>
          <button
            type="button"
            class="btn-secondary mt-2 w-full"
            :disabled="!canCreateOrder || saving"
            @click="saveDraftOrder"
          >
            Sauvegarder en brouillon
          </button>
        </aside>
      </section>
    </template>
  </div>
</template>
