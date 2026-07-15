# Icons (SF Symbols)

Use SF Symbols for native feel. Never use FontAwesome or Ionicons.

## Basic Usage

Render SF Symbols with `expo-image` using the `sf:` source prefix:

```tsx
import { Image } from "expo-image";
import { colors } from "@/theme/colors";

<Image
  source="sf:square.and.arrow.down"
  tintColor={colors.label}
  contentFit="contain"
  style={{ width: 16, height: 16 }}
/>;
```

## Props

```tsx
<Image
  source="sf:star.fill"               // SF Symbol name with sf: prefix (required)
  tintColor={colors.label}            // Icon color
  contentFit="contain"                // How to scale
  style={{ width: 24, height: 24 }}   // Icon size via standard style props
/>
```

## Common Icons

### Navigation & Actions
- `house.fill` - home
- `gear` - settings
- `magnifyingglass` - search
- `plus` - add
- `xmark` - close
- `chevron.left` - back
- `chevron.right` - forward
- `arrow.left` - back arrow
- `arrow.right` - forward arrow

### Media
- `play.fill` - play
- `pause.fill` - pause
- `stop.fill` - stop
- `backward.fill` - rewind
- `forward.fill` - fast forward
- `speaker.wave.2.fill` - volume
- `speaker.slash.fill` - mute

### Camera
- `camera` - camera
- `camera.fill` - camera filled
- `arrow.triangle.2.circlepath` - flip camera
- `photo` - gallery/photos
- `bolt` - flash
- `bolt.slash` - flash off

### Communication
- `message` - message
- `message.fill` - message filled
- `envelope` - email
- `envelope.fill` - email filled
- `phone` - phone
- `phone.fill` - phone filled
- `video` - video call
- `video.fill` - video call filled

### Social
- `heart` - like
- `heart.fill` - liked
- `star` - favorite
- `star.fill` - favorited
- `hand.thumbsup` - thumbs up
- `hand.thumbsdown` - thumbs down
- `person` - profile
- `person.fill` - profile filled
- `person.2` - people
- `person.2.fill` - people filled

### Content Actions
- `square.and.arrow.up` - share
- `square.and.arrow.down` - download
- `doc.on.doc` - copy
- `trash` - delete
- `pencil` - edit
- `folder` - folder
- `folder.fill` - folder filled
- `bookmark` - bookmark
- `bookmark.fill` - bookmarked

### Status & Feedback
- `checkmark` - success/done
- `checkmark.circle.fill` - completed
- `xmark.circle.fill` - error/failed
- `exclamationmark.triangle` - warning
- `info.circle` - info
- `questionmark.circle` - help
- `bell` - notification
- `bell.fill` - notification filled

### Misc
- `ellipsis` - more options
- `ellipsis.circle` - more in circle
- `line.3.horizontal` - menu/hamburger
- `slider.horizontal.3` - filters
- `arrow.clockwise` - refresh
- `location` - location
- `location.fill` - location filled
- `map` - map
- `mappin` - pin
- `clock` - time
- `calendar` - calendar
- `link` - link
- `nosign` - block/prohibited

## Animated Symbols

Use the `sfEffect` prop of `expo-image` to apply SF Symbol effects:

```tsx
<Image
  source="sf:checkmark.circle"
  tintColor={colors.label}
  sfEffect="bounce"
  style={{ width: 24, height: 24 }}
/>
```

## Finding Symbol Names

1. Use the SF Symbols app on macOS (free from Apple)
2. Search at https://developer.apple.com/sf-symbols/
3. Symbol names use dot notation: `square.and.arrow.up`

## Best Practices

- Use `expo-image` with `sf:` sources for iOS SF Symbols (never `expo-symbols` — see SKILL.md "Library Preferences")
- Use `tintColor` from the shared semantic color helper (see SKILL.md "Colors") to support dark mode
- Use `.fill` variants for selected/active states
- Keep icons at consistent sizes (16, 20, 24, 32)
- Provide a deliberate Android/web fallback when the screen is cross-platform (`sf:` sources are iOS-only)
