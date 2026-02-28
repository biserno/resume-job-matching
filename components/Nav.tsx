import Link from "next/link";

const links = [
  { href: "/resumes", label: "Resumes" },
  { href: "/jobs", label: "Jobs" },
  { href: "/matches", label: "Matches" },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-xl px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}