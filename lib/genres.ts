// The curated genre list behind "browse by genre". Each entry maps a friendly
// label the user picks in Settings to the Open Library subject phrase the catalog
// discovery engine (`/api/discover`) queries — the raw OL subjects are too noisy
// to show directly, so we hand-pick a small, recognizable set. We store the stable
// `id` (not the label or subject) on the user profile, so labels/subjects can be
// retuned without rewriting saved preferences.

export type Genre = {
  id: string
  label: string
  subject: string // Open Library subject phrase, matched as a quoted term server-side
}

export const GENRES: Genre[] = [
  { id: "fantasy", label: "Fantasy", subject: "fantasy" },
  { id: "sci-fi", label: "Science Fiction", subject: "science fiction" },
  { id: "mystery", label: "Mystery", subject: "mystery" },
  { id: "thriller", label: "Thriller", subject: "thriller" },
  { id: "romance", label: "Romance", subject: "romance" },
  { id: "horror", label: "Horror", subject: "horror" },
  { id: "historical-fiction", label: "Historical Fiction", subject: "historical fiction" },
  { id: "literary-fiction", label: "Literary Fiction", subject: "literary fiction" },
  { id: "young-adult", label: "Young Adult", subject: "young adult fiction" },
  { id: "graphic-novels", label: "Graphic Novels", subject: "graphic novels" },
  { id: "nonfiction", label: "Nonfiction", subject: "nonfiction" },
  { id: "biography", label: "Biography", subject: "biography" },
  { id: "history", label: "History", subject: "history" },
  { id: "science", label: "Science", subject: "science" },
  { id: "poetry", label: "Poetry", subject: "poetry" },
  { id: "self-help", label: "Self-Help", subject: "self-help" },
]

// Shown on the Search page before a user has picked any favorites — a broad,
// crowd-pleasing starter set so the browse experience isn't empty out of the box.
export const DEFAULT_GENRE_IDS = [
  "fantasy",
  "sci-fi",
  "mystery",
  "romance",
  "historical-fiction",
]

const GENRES_BY_ID = new Map(GENRES.map((g) => [g.id, g]))

export const genreById = (id: string): Genre | undefined => GENRES_BY_ID.get(id)
