---
name: Rangkuman Kajian
description: A personal study book with evidence in its margins.
colors:
  primary: "#405c46"
  paper: "#f8f6ef"
  ink: "#252c25"
  muted-text: "#62665c"
  rule: "#dcded1"
  reference-surface: "#eef0e6"
  review: "#795314"
typography:
  display:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(36px, 4.4vw, 54px)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "18px"
    lineHeight: 1.9
  controls:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
  arabic:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "24px"
    lineHeight: 2
rounded:
  panel: "6px"
  label: "4px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  evidence-quotation:
    backgroundColor: "{colors.reference-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

## Overview

**Creative North Star: "A book with margin notes"**

Reading leads. Source inspection opens beside the article or in an accessible sheet. The surface is warm, quiet, and suitable for repeated study.

## Colors

Paper and ink carry the article. Green identifies navigation and source links. Amber identifies review needs and always includes a text label. The palette's normal-text pairs exceed 4.5:1 contrast.

## Typography

Self-hosted Lora carries headings and article prose. System sans-serif carries controls and provenance. Noto Naskh Arabic carries right-to-left Arabic source text. Readers can choose 16, 18, 20, or 22-pixel article text.

## Layout

The library uses a compact list. The reader has a contents column and an article column up to 740 pixels wide. The contents become a sheet at mobile widths. At 1600 pixels and wider, selected evidence opens in a third column. At smaller widths, it opens in a sheet.

## Elevation & Depth

Thin rules and changes in surface color separate content. Modal sheets use a dimmed overlay and the shadcn shadow. Article content has no decorative shadows.

## Shapes

Surfaces use small corners. Section rules and whitespace organize the prose. Checkboxes and controls retain recognizable shapes and visible keyboard focus.

## Components

shadcn/ui provides Button, Sheet, and Checkbox. Lucide provides interface icons. Library entries show owner-review status and evidence freshness separately. Evidence panels retain provider attribution, timestamps, model-confidence wording, and stale warnings.

## Do's and Don'ts

- Keep source links and review indicators close to the claim they describe.
- Preserve the section emojis explicitly requested in the user's Markdown format. This is a deliberate exception to the generic icon guidance.
- Keep controls secondary to the article.
- Do not present model confidence as religious authenticity.
- Do not hide the article when browser storage or evidence metadata is unavailable.
