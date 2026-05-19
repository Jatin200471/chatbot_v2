<script>
// Override of upstream `app/javascript/shared/components/Branding.vue`.
// NOTE the path — Branding lives under `shared/`, not `widget/`. Earlier
// versions of the Dockerfile copied this file to the wrong destination
// (widget/components/Branding.vue, which nothing imports), so the upstream
// component with its <a href="https://www.chatwoot.com"> kept being used.
//
// Upstream wraps the "Powered by …" text in an <a href="https://www.chatwoot.com">
// which still pointed visitors back to Chatwoot even after we localised the
// label to "Powered by Visual Graphx". This replacement renders the label as
// a plain, non-clickable span so there's no outbound link, no Chatwoot logo,
// and no surprise navigation. The i18n key (`POWERED_BY`) is what controls
// the visible text — see custom/widget/i18n/en.json.
export default {
  name: 'Branding',
};
</script>

<template>
  <div class="branding flex items-center justify-center text-xs text-n-slate-11">
    <span class="branding__label">{{ $t('POWERED_BY') }}</span>
  </div>
</template>

<style scoped>
.branding {
  user-select: none;
  padding: 4px 0;
}
.branding__label {
  font-weight: 500;
}
</style>
