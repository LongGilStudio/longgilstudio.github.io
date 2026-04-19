# Chirpy Starter

[![Gem Version](https://img.shields.io/gem/v/jekyll-theme-chirpy)][gem]&nbsp;
[![GitHub license](https://img.shields.io/github/license/cotes2020/chirpy-starter.svg?color=blue)][mit]

A minimal, ready-to-use template for creating a blog with the [**Chirpy**][chirpy] Jekyll theme. Get up and running in minutes with all critical files pre-configured.

## Why This Starter Exists

When installing Chirpy through [RubyGems.org][gem], Jekyll can only read a subset of theme files (`_data`, `_layouts`, `_includes`, `_sass`, `assets`) and limited `_config.yml` options from the gem. As a result, users cannot enjoy the full out-of-the-box experience that Chirpy offers.

To unlock all features, the following files must be present in your Jekyll site:

```shell
.
├── _config.yml
├── _plugins
├── _tabs
└── index.html
```

This starter bundles those files from the latest **Chirpy** release along with a [CD][CD] workflow, so you can start writing immediately.

## Usage

Here are some comprehensive instructions to help you run the server, format text, customize the favicon, and write a new post, based on the official [theme's docs](https://github.com/cotes2020/jekyll-theme-chirpy/wiki).

### 1. Getting Started & Running the Server

To launch the local Jekyll server, execute the following command in the root directory:

```shell
bundle exec jekyll serve
```

Alternatively, if you are using Dev Containers, you can run `./tools/run.sh` or use the VS Code task `Run Jekyll Server`. The site will soon be available at `http://127.0.0.1:4000/`.

*For more details: [Getting Started](https://chirpy.cotes.page/posts/getting-started/)*

### 2. Writing a New Post

1. Navigate to the `_posts` folder.
2. Create a new markdown file named in the layout: `YYYY-MM-DD-TITLE.md`.
3. Add the **Front Matter** block at the top of your markdown file:

```yaml
---
title: TITLE
date: YYYY-MM-DD HH:MM:SS +/-TTTT
categories: [TOP_CATEGORY, SUB_CATEGORY]
tags: [TAG]
---
```

You can optionally define author info, math configurations `math: true`, or image paths.

*For more details: [Writing a New Post](https://chirpy.cotes.page/posts/write-a-new-post/)*

### 3. Text and Typography

You can take advantage of various Markdown layout formats such as:
- **Prompts**: Wrap blocks with `> Text {: .prompt-info }` or `prompt-warning`, `prompt-tip`, `prompt-danger` to produce callouts.
- **Mathematics**: Enable `math: true` in your front matter. You can then render MathJax inline like `$$ math $$` and block equations with `$$ math $$` on their own lines.
- **Mermaid Diagrams**: Include `mermaid: true` and write ````mermaid` blocks to generate graphs.
- **Media and Alignment**: Format images with classes `{: .normal }`, `{: .left }`, or `{: .right }`, `{: width="700" height="400" }` and shadow `{: .shadow }`.

*For more details: [Text and Typography](https://chirpy.cotes.page/posts/text-and-typography/)*

### 4. Customizing the Favicon

1. Use a tool like [Real Favicon Generator](https://realfavicongenerator.net/) to generate a `.ZIP` file from your 512x512 image.
2. Delete the `site.webmanifest` generated file.
3. Replace your `.PNG`, `.ICO` and `.SVG` files into the `assets/img/favicons/` folder of your project, overwriting the defaults.
4. Next time you run or build Jekyll, the newly custom icon will appear.

*For more details: [Customize the Favicon](https://chirpy.cotes.page/posts/customize-the-favicon/)*

## Contributing

This repository is automatically updated with new releases from the theme repository. If you encounter any issues or want to contribute to its improvement, please visit the [theme repository][chirpy] to provide feedback.

## License

This work is published under [MIT][mit] License.

[gem]: https://rubygems.org/gems/jekyll-theme-chirpy
[chirpy]: https://github.com/cotes2020/jekyll-theme-chirpy/
[CD]: https://en.wikipedia.org/wiki/Continuous_deployment
[mit]: https://github.com/cotes2020/chirpy-starter/blob/master/LICENSE
