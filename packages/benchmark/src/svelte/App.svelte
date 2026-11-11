<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteFlow } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { edges, nodes } from "../fixture";

  onMount(() => {
    requestAnimationFrame(() => {
      document
        .querySelector(".bench-root")
        ?.setAttribute("data-bench-ready", "true");
    });
  });
</script>

<div class="bench-root">
  <SvelteFlow {nodes} {edges} fitView />
</div>
