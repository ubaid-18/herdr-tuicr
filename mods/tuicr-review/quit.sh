#!/bin/sh
# Save and quit through hc's raw terminal API. hc keys cannot encode ":" on
# older cores (shift+; sends ";" instead). Only called after checking ownership,
# foreground program, and tuicr's NORMAL/SELECT mode in the controller.
set -eu
export LC_ALL=C
address=$1
attach=$2
work=$(mktemp -d)
peer=
drain=
cleanup() {
    [ -z "$peer" ] || kill "$peer" 2>/dev/null || :
    [ -z "$drain" ] || kill "$drain" 2>/dev/null || :
    exec 3>&- 4<&-
    [ -z "$peer" ] || wait "$peer" 2>/dev/null || :
    [ -z "$drain" ] || wait "$drain" 2>/dev/null || :
    rm -f "$work/in" "$work/out"
    rmdir "$work"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkfifo "$work/in" "$work/out"
hc connect <"$work/in" >"$work/out" &
peer=$!
exec 3>"$work/in" 4<"$work/out"
printf '%s\n' '{"jsonrpc":"2.0","id":0,"method":"hello","params":{"framed":true}}' >&3
IFS= read -r hello <&4
case "$hello" in *'"error"'*) printf '%s\n' "$hello" >&2; exit 1;; esac

u32() {
    for shift in 0 8 16 24; do
        printf '%b' "\\$(printf '%03o' "$((($1 >> shift) & 255))")"
    done
}
frame() {
    # channel u32 LE, kind DATA (0), payload byte length u32 LE, payload.
    u32 "$1"
    printf '\000'
    u32 "${#2}"
    printf '%s' "$2"
}
frame 0 "$attach" >&3
# The attach reply precedes its first paint. Read exactly one framed JSON reply.
set -- $(dd bs=1 count=9 <&4 2>/dev/null | od -An -t u1)
[ "$#" -eq 9 ] && [ "$1$2$3$4$5" = 00000 ] || exit 1
length=$(($6 + ($7 << 8) + ($8 << 16) + ($9 << 24)))
[ "$length" -gt 0 ] && [ "$length" -le 65536 ] || exit 1
reply=$(dd bs=1 count="$length" <&4 2>/dev/null)
case "$reply" in *'"error"'*) printf '%s\n' "$reply" >&2; exit 1;; esac
channel=$(printf '%s' "$reply" | sed -n 's/.*"channel":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
case "$channel" in ''|*[!0-9]*) exit 1;; esac
[ "$channel" -gt 0 ] || exit 1
# Drain paints so a large screen cannot block the connection. No terminal output
# is printed into the caller's terminal, and the original terminal size is kept.
cat <&4 >/dev/null &
drain=$!
frame "$channel" "$(printf '\033[27u:wq\rn')" >&3
# :wq saves, then optionally asks about clipboard export; n declines the export.
# A failed write stays live. Never escalate to a signal or delete saved reviews.
hc wait "$address" --timeout 3 --json
