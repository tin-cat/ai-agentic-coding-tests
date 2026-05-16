# AI agentic coding tests
Benchmarks for LLM models and agentic coding platforms across real-world coding tasks, providers, and hardware setups.

This repository gives you a clearer picture of how different tools perform on real coding tasks. Useful if you're deciding, for example, whether a local inference setup or a cloud-based one is the better fit for your workflow.

Each test simulates a real coding task, with results divided into multiple stages that progress from a first unattended run to the incremental implementation of complex refinements. Users [contribute](CONTRIBUTING.md) their runs across different combinations of models, providers, and settings, and also new tests.

## Tests structure

Each test has its directory under `/tests`. Inside each test, you'll find:

- `prompts.md` — The prompts for each stage of that test, exactly as they're fed into the LLMs.
- `benchmarks.md` — Benchmark results for each tested provider/model combination.
- `/results/` — The resulting code for each tested provider/model combination. Each subdirectory represents a specific combination of inference provider, LLM, and settings.

## Example test structure

Here is an example of the directory structure for the `live-message-wall` test:

```
/tests
    /live-message-wall
        benchmarks.md
        prompts.md
        /results
            /tin-cat
                /claude-code-pro-opus-4.7-high-effort
                    /stage-1-first-run
                    /stage-2-advanced-features
                    /stage-3-refinements
                    /stage-4-complex-refinements
                /claude-code-pro-sonnet-4.6-high-effort
                    /stage-1-first-run
                    /stage-2-advanced-features
                    /stage-3-refinements
                    /stage-4-complex-refinements
```

## Contribute
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
