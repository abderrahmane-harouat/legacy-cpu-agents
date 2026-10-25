#!/bin/bash
# Usage: isascan.sh <elf or .a>  -> counts instructions above the legacy floor (SSE2 + CX16 + LAHF).
# A rough census: runtime-dispatched code (simdutf, highway, BoringSSL, ...) is counted too; the QEMU runs decide.
objdump -d --no-show-raw-insn "$1" 2>/dev/null | awk '
BEGIN{
 split("addsubpd addsubps haddpd haddps hsubpd hsubps lddqu movddup movshdup movsldup fisttp fisttps fisttpl fisttpll",a," "); for(i in a) c[a[i]]="SSE3"
 split("pshufb palignr phaddw phaddd phaddsw phsubw phsubd phsubsw pabsb pabsw pabsd pmaddubsw pmulhrsw psignb psignw psignd",a," "); for(i in a) c[a[i]]="SSSE3"
 c["rdtscp"]="RDTSCP"
 split("pblendvb blendps blendpd blendvps blendvpd dpps dppd extractps insertps movntdqa mpsadbw packusdw pcmpeqq pextrb pextrd pextrq pinsrb pinsrd pinsrq phminposuw pmaxsb pmaxsd pmaxud pmaxuw pminsb pminsd pminud pminuw pmovsxbw pmovsxbd pmovsxbq pmovsxwd pmovsxwq pmovsxdq pmovzxbw pmovzxbd pmovzxbq pmovzxwd pmovzxwq pmovzxdq pmuldq pmulld ptest roundps roundpd roundss roundsd",a," "); for(i in a) c[a[i]]="SSE4.1"
 split("pcmpestri pcmpestrm pcmpistri pcmpistrm pcmpgtq crc32b crc32w crc32l crc32q crc32",a," "); for(i in a) c[a[i]]="SSE4.2"
 c["popcnt"]="POPCNT"; c["popcntl"]="POPCNT"; c["popcntq"]="POPCNT"; c["popcntw"]="POPCNT"
 c["lzcnt"]="LZCNT"; c["lzcntl"]="LZCNT"; c["lzcntq"]="LZCNT"
 split("andn andnl andnq bextr bextrl bextrq blsi blsil blsiq blsmsk blsmskl blsmskq blsr blsrl blsrq tzcnt tzcntl tzcntq tzcntw",a," "); for(i in a) c[a[i]]="BMI1"
 split("bzhi bzhil bzhiq mulx mulxl mulxq pdep pdepl pdepq pext pextl pextq rorx rorxl rorxq sarx sarxl sarxq shlx shlxl shlxq shrx shrxl shrxq",a," "); for(i in a) c[a[i]]="BMI2"
 split("aesenc aesenclast aesdec aesdeclast aesimc aeskeygenassist",a," "); for(i in a) c[a[i]]="AES"
 c["pclmulqdq"]="PCLMUL"; c["movbe"]="MOVBE"; c["movbel"]="MOVBE"; c["movbeq"]="MOVBE"
 split("sha1rnds4 sha1nexte sha1msg1 sha1msg2 sha256rnds2 sha256msg1 sha256msg2",a," "); for(i in a) c[a[i]]="SHA"
 c["rdrand"]="RDRAND"; c["rdrandq"]="RDRAND"; c["rdrandl"]="RDRAND"; c["rdseed"]="RDSEED"; c["rdseedq"]="RDSEED"
}
/^[[:space:]]*[0-9a-f]+:/ { sub(/^[[:space:]]*[0-9a-f]+:[[:space:]]*/, "") }
/^[0-9a-f]+ </ || /:$/ || NF == 0 { next }
{ m=$1; if(m ~ /^(rep|repz|repnz|lock|notrack|data16|cs|ds|bnd)$/) m=$2
  if(m in c) n[c[m]]++
  else if(m ~ /^v/ && m !~ /^ver[rw]/) { if($0 ~ /%zmm|%k[0-7]/) n["AVX512"]++; else if($0 ~ /%ymm/) n["AVX/AVX2(ymm)"]++; else n["AVX(VEX xmm)"]++ }
  total++ }
END{ printf "total_insns=%d\n", total; for(k in n) printf "  %-16s %d\n", k, n[k] }'
