# AI agentic coding test
The same coding prompts, fed into different AI models for agentic coding and their results, benchmarked for a realistic usage comparison.

Each test simulates a real coding task, and results are divided into multiple stages from a first unattended run to the incremental implementation of complex refinements.

## Tests structure

Each test has his directory under `/tests`. Inside each test, you'll find the following files:

- `prompts.md` The prompts for that test for each stage, exactly as they're fed into the LLMs.
- `benchmarks.md` Benchmark results for each tested provider/model combination for that test.
- `/results` Holds the resulting code for each tested provider/model combination for that test. Each subdirectory represents the combination of inference provider, LLM and settings used for testing.

## Example test structure

This is the directory structure for the test `live-message-wall`:

```
/tests
    /live-message-wall
        benchmarks.md
        prompts.md
        /results
            /tin-cat
                /claude-code-pro-opus-4.7-high-effort
                /claude-code-pro-sonnet-4.6-high-effort
                    /stage-1-first-run
                    /stage-2-advanced-features
                    /stage-3-refinements
                    /stage-4-complex-features
```

## Contribute
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.


- **prompt** Is one of the prompts in `/prompts`, like `live-message-wall`
- **provider** The provider used to run the model, for example: `claude-code`, `google-antigravity` or also local inference setups like `lmstudio-macbook-pro-m1-32gb`.
- **model** The full model name, like `qwen3.6-35b-a3b`
- **run** One of the following:
    - `first-run` What came out after the first run.
    - `advanced-features` What came out after asking for advanced features, in an entirely new session.
    - `refinements` What came out after asking for refinements and bug solving if needed.
    - `complex-refinements` What came out after asking for complex refinements and bug solving if needed.