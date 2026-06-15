<script setup>
import { ref, computed, watch } from 'vue';
import { Chrome } from '@lk77/vue3-color';
import { OnClickOutside } from '@vueuse/components';
import Button from 'dashboard/components-next/button/Button.vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue']);

const isPickerOpen = ref(false);

const isGradientValue = v =>
  v && (v.startsWith('linear-gradient') || v.startsWith('radial-gradient'));

const parseGradient = value => {
  if (!isGradientValue(value)) {
    return { angle: 135, color1: value || '#1f93ff', color2: '#00b4d8' };
  }
  const m = value.match(/linear-gradient\((\d+)deg,\s*(#[a-fA-F0-9]{3,8}),\s*(#[a-fA-F0-9]{3,8})\)/);
  if (m) return { angle: parseInt(m[1]), color1: m[2], color2: m[3] };
  return { angle: 135, color1: '#1f93ff', color2: '#00b4d8' };
};

const mode = ref(isGradientValue(props.modelValue) ? 'gradient' : 'solid');
const parsed = parseGradient(props.modelValue);
const angle = ref(parsed.angle);
const color1 = ref(parsed.color1);
const color2 = ref(parsed.color2);
const activePicker = ref(null); // 'color1' | 'color2' | null

const gradientValue = computed(
  () => `linear-gradient(${angle.value}deg, ${color1.value}, ${color2.value})`
);

watch(
  () => props.modelValue,
  val => {
    if (isGradientValue(val)) {
      mode.value = 'gradient';
      const p = parseGradient(val);
      angle.value = p.angle;
      color1.value = p.color1;
      color2.value = p.color2;
    } else {
      mode.value = 'solid';
    }
  }
);

const togglePicker = () => { isPickerOpen.value = !isPickerOpen.value; };
const closePicker = () => { isPickerOpen.value = false; activePicker.value = null; };

const switchMode = m => {
  mode.value = m;
  emit('update:modelValue', m === 'gradient' ? gradientValue.value : color1.value);
};

const updateSolid = e => emit('update:modelValue', e.hex);

const updateColor1 = e => {
  color1.value = e.hex;
  emit('update:modelValue', gradientValue.value);
};

const updateColor2 = e => {
  color2.value = e.hex;
  emit('update:modelValue', gradientValue.value);
};

const updateAngle = e => {
  angle.value = parseInt(e.target.value);
  emit('update:modelValue', gradientValue.value);
};
</script>

<template>
  <div class="relative w-fit">
    <OnClickOutside @trigger="closePicker">
      <Button
        color="slate"
        icon="i-lucide-pipette"
        trailing-icon
        class="!px-3 !py-3 [&>svg]:w-4 [&>svg]:h-4"
        @click="togglePicker"
      >
        <div class="flex items-center flex-grow gap-2">
          <span class="rounded-md size-4 border border-n-weak" :style="{ background: modelValue || '#1f93ff' }" />
          <span class="min-w-0 truncate max-w-36 text-xs">{{ modelValue }}</span>
        </div>
      </Button>

      <div
        v-if="isPickerOpen"
        class="absolute z-[9999] mt-1 bg-n-background border border-n-weak rounded-lg shadow-lg p-3 w-72"
      >
        <!-- Solid / Gradient toggle -->
        <div class="flex gap-1 mb-3 bg-n-alpha-3 rounded-md p-1">
          <button
            class="flex-1 text-xs py-1.5 rounded font-medium transition-colors"
            :class="mode === 'solid' ? 'bg-n-background text-n-slate-12 shadow-sm' : 'text-n-slate-9 hover:text-n-slate-11'"
            @click="switchMode('solid')"
          >
            Solid
          </button>
          <button
            class="flex-1 text-xs py-1.5 rounded font-medium transition-colors"
            :class="mode === 'gradient' ? 'bg-n-background text-n-slate-12 shadow-sm' : 'text-n-slate-9 hover:text-n-slate-11'"
            @click="switchMode('gradient')"
          >
            Gradient
          </button>
        </div>

        <!-- SOLID MODE -->
        <Chrome
          v-if="mode === 'solid'"
          disable-alpha
          :model-value="isGradientValue(modelValue) ? color1 : modelValue"
          class="colorpicker--chrome !shadow-none !border-0 !bg-transparent"
          @update:model-value="updateSolid"
        />

        <!-- GRADIENT MODE -->
        <div v-else class="flex flex-col gap-3">
          <!-- Preview bar -->
          <div class="h-10 rounded-lg w-full border border-n-weak" :style="{ background: gradientValue }" />

          <!-- Angle -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-n-slate-9 shrink-0 w-10">Angle</span>
            <input
              type="range" min="0" max="360" :value="angle"
              class="flex-1 accent-n-brand"
              @input="updateAngle"
            />
            <span class="text-xs text-n-slate-11 w-9 text-right font-mono">{{ angle }}°</span>
          </div>

          <!-- Start color -->
          <div class="flex flex-col gap-1.5">
            <button
              class="flex items-center gap-2 w-full hover:bg-n-alpha-3 rounded-md px-1 py-1 transition-colors"
              @click="activePicker = activePicker === 'color1' ? null : 'color1'"
            >
              <span class="size-5 rounded border border-n-weak shrink-0" :style="{ background: color1 }" />
              <span class="text-xs text-n-slate-11">Start Color</span>
              <span class="text-xs text-n-slate-9 ml-auto font-mono">{{ color1 }}</span>
              <span class="text-xs text-n-slate-9">{{ activePicker === 'color1' ? '▲' : '▼' }}</span>
            </button>
            <Chrome
              v-if="activePicker === 'color1'"
              disable-alpha
              :model-value="color1"
              class="colorpicker--chrome !shadow-none !border-0 !bg-transparent"
              @update:model-value="updateColor1"
            />
          </div>

          <!-- End color -->
          <div class="flex flex-col gap-1.5">
            <button
              class="flex items-center gap-2 w-full hover:bg-n-alpha-3 rounded-md px-1 py-1 transition-colors"
              @click="activePicker = activePicker === 'color2' ? null : 'color2'"
            >
              <span class="size-5 rounded border border-n-weak shrink-0" :style="{ background: color2 }" />
              <span class="text-xs text-n-slate-11">End Color</span>
              <span class="text-xs text-n-slate-9 ml-auto font-mono">{{ color2 }}</span>
              <span class="text-xs text-n-slate-9">{{ activePicker === 'color2' ? '▲' : '▼' }}</span>
            </button>
            <Chrome
              v-if="activePicker === 'color2'"
              disable-alpha
              :model-value="color2"
              class="colorpicker--chrome !shadow-none !border-0 !bg-transparent"
              @update:model-value="updateColor2"
            />
          </div>
        </div>
      </div>
    </OnClickOutside>
  </div>
</template>

<style scoped lang="scss">
.colorpicker--chrome.vc-chrome {
  @apply shadow-lg bg-n-background z-[9999] border border-n-weak dark:border-n-weak rounded-[8px];
  :deep() {
    .vc-chrome-saturation-wrap {
      @apply rounded-t-[7px];
      .vc-saturation { @apply rounded-t-[8px]; }
    }
    .vc-chrome-body {
      @apply rounded-b-[7px] bg-n-alpha-3;
      .vc-chrome-toggle-btn {
        .vc-chrome-toggle-icon svg {
          @apply [&>path]:fill-n-slate-10 dark:[&>path]:fill-n-slate-10 left-3 relative;
        }
        .vc-chrome-toggle-icon-highlight { @apply bg-n-background; }
      }
    }
    input, .vc-input__input {
      @apply bg-n-background text-n-slate-12 rounded-md shadow-none;
    }
    .vc-input__label { @apply text-n-slate-11 dark:text-n-slate-11; }
  }
}
</style>
