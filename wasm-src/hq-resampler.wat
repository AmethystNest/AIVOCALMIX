;; VM_HQ_RESAMPLER_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 1001 bytes; executable sections: 727 bytes.
(module $resampler.wasm
  (type $t0 (func (param i32 i32 i32 i32 i32 i32 i32 f64 f64)))
  (func $vm_resample_polyphase (type $t0) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32) (param $p5 i32) (param $p6 i32) (param $p7 f64) (param $p8 f64)
    (local $l9 i32) (local $l10 i32) (local $l11 i32) (local $l12 i32) (local $l13 i32) (local $l14 f64) (local $l15 i32) (local $l16 i32) (local $l17 i32) (local $l18 i32) (local $l19 f64) (local $l20 f64) (local $l21 i32) (local $l22 i32) (local $l23 i32) (local $l24 i32) (local $l25 i32)
    (block $B0
      (br_if $B0
        (i32.lt_s
          (local.get $p6)
          (i32.const 1)))
      (local.set $l9
        (i32.div_s
          (local.get $p4)
          (i32.const -2)))
      (local.set $l10
        (i32.const 0))
      (block $B1
        (br_if $B1
          (i32.gt_s
            (local.get $p4)
            (i32.const 0)))
        (local.set $l11
          (i32.and
            (local.get $p6)
            (i32.const 7)))
        (block $B2
          (br_if $B2
            (i32.lt_u
              (local.get $p6)
              (i32.const 8)))
          (local.set $p1
            (i32.and
              (local.get $p6)
              (i32.const 2147483640)))
          (local.set $l10
            (i32.const 0))
          (local.set $l12
            (local.get $p5))
          (loop $L3
            (i64.store align=4
              (local.get $l12)
              (i64.const 0))
            (i64.store align=4
              (i32.add
                (local.get $l12)
                (i32.const 24))
              (i64.const 0))
            (i64.store align=4
              (i32.add
                (local.get $l12)
                (i32.const 16))
              (i64.const 0))
            (i64.store align=4
              (i32.add
                (local.get $l12)
                (i32.const 8))
              (i64.const 0))
            (local.set $l12
              (i32.add
                (local.get $l12)
                (i32.const 32)))
            (br_if $L3
              (i32.ne
                (local.get $p1)
                (local.tee $l10
                  (i32.add
                    (local.get $l10)
                    (i32.const 8)))))))
        (br_if $B0
          (i32.eqz
            (local.get $l11)))
        (local.set $l12
          (i32.add
            (local.get $p5)
            (i32.shl
              (local.get $l10)
              (i32.const 2))))
        (loop $L4
          (i32.store
            (local.get $l12)
            (i32.const 0))
          (local.set $l12
            (i32.add
              (local.get $l12)
              (i32.const 4)))
          (br_if $L4
            (local.tee $l11
              (i32.add
                (local.get $l11)
                (i32.const -1))))
          (br $B0)))
      (local.set $l13
        (i32.add
          (local.get $l9)
          (i32.const 1)))
      (local.set $l14
        (f64.convert_i32_s
          (local.get $p3)))
      (local.set $l15
        (i32.add
          (local.get $p0)
          (i32.const 8)))
      (local.set $l16
        (i32.and
          (local.get $p4)
          (i32.const 2147483646)))
      (local.set $l17
        (i32.and
          (local.get $p4)
          (i32.const 1)))
      (local.set $l18
        (i32.const 0))
      (local.set $l19
        (f64.const 0x0p+0 (;=0;)))
      (loop $L5
        (block $B6
          (block $B7
            (br_if $B7
              (i32.eqz
                (f64.lt
                  (f64.abs
                    (local.tee $l20
                      (f64.add
                        (f64.mul
                          (local.get $l19)
                          (local.get $p8))
                        (local.get $p7))))
                  (f64.const 0x1p+31 (;=2.14748e+09;)))))
            (local.set $l21
              (i32.trunc_f64_s
                (local.get $l20)))
            (br $B6))
          (local.set $l21
            (i32.const -2147483648)))
        (block $B8
          (block $B9
            (br_if $B9
              (i32.eqz
                (f64.lt
                  (f64.abs
                    (local.tee $l20
                      (f64.add
                        (f64.mul
                          (f64.sub
                            (local.get $l20)
                            (f64.convert_i32_s
                              (local.get $l21)))
                          (local.get $l14))
                        (f64.const 0x1p-1 (;=0.5;)))))
                  (f64.const 0x1p+31 (;=2.14748e+09;)))))
            (local.set $l11
              (i32.trunc_f64_s
                (local.get $l20)))
            (br $B8))
          (local.set $l11
            (i32.const -2147483648)))
        (local.set $l12
          (i32.const 0))
        (local.set $l23
          (i32.add
            (local.get $p2)
            (i32.shl
              (i32.mul
                (select
                  (i32.const 0)
                  (local.get $l11)
                  (local.tee $l22
                    (i32.ge_s
                      (local.get $l11)
                      (local.get $p3))))
                (local.get $p4))
              (i32.const 2))))
        (local.set $l20
          (f64.const 0x0p+0 (;=0;)))
        (block $B10
          (br_if $B10
            (i32.eq
              (local.get $p4)
              (i32.const 1)))
          (local.set $l11
            (i32.add
              (local.get $l15)
              (i32.shl
                (local.tee $l24
                  (i32.add
                    (i32.add
                      (local.get $l9)
                      (local.get $l21))
                    (local.get $l22)))
                (i32.const 2))))
          (local.set $l20
            (f64.const 0x0p+0 (;=0;)))
          (local.set $l12
            (i32.const 0))
          (local.set $l10
            (local.get $l23))
          (loop $L11
            (block $B12
              (br_if $B12
                (i32.ge_u
                  (i32.add
                    (local.tee $l25
                      (i32.add
                        (local.get $l24)
                        (local.get $l12)))
                    (i32.const 1))
                  (local.get $p1)))
              (local.set $l20
                (f64.add
                  (f64.mul
                    (f64.promote_f32
                      (f32.load
                        (i32.add
                          (local.get $l11)
                          (i32.const -4))))
                    (f64.promote_f32
                      (f32.load
                        (local.get $l10))))
                  (local.get $l20))))
            (block $B13
              (br_if $B13
                (i32.ge_u
                  (i32.add
                    (local.get $l25)
                    (i32.const 2))
                  (local.get $p1)))
              (local.set $l20
                (f64.add
                  (f64.mul
                    (f64.promote_f32
                      (f32.load
                        (local.get $l11)))
                    (f64.promote_f32
                      (f32.load
                        (i32.add
                          (local.get $l10)
                          (i32.const 4)))))
                  (local.get $l20))))
            (local.set $l10
              (i32.add
                (local.get $l10)
                (i32.const 8)))
            (local.set $l11
              (i32.add
                (local.get $l11)
                (i32.const 8)))
            (br_if $L11
              (i32.ne
                (local.get $l16)
                (local.tee $l12
                  (i32.add
                    (local.get $l12)
                    (i32.const 2)))))))
        (block $B14
          (br_if $B14
            (i32.eqz
              (local.get $l17)))
          (br_if $B14
            (i32.ge_u
              (local.tee $l11
                (i32.add
                  (i32.add
                    (i32.add
                      (local.get $l13)
                      (local.get $l21))
                    (local.get $l22))
                  (local.get $l12)))
              (local.get $p1)))
          (local.set $l20
            (f64.add
              (f64.mul
                (f64.promote_f32
                  (f32.load
                    (i32.add
                      (local.get $p0)
                      (i32.shl
                        (local.get $l11)
                        (i32.const 2)))))
                (f64.promote_f32
                  (f32.load
                    (i32.add
                      (local.get $l23)
                      (i32.shl
                        (local.get $l12)
                        (i32.const 2))))))
              (local.get $l20))))
        (f32.store
          (i32.add
            (local.get $p5)
            (i32.shl
              (local.get $l18)
              (i32.const 2)))
          (f32.demote_f64
            (local.get $l20)))
        (local.set $l19
          (f64.add
            (local.get $l19)
            (f64.const 0x1p+0 (;=1;))))
        (br_if $L5
          (i32.ne
            (local.tee $l18
              (i32.add
                (local.get $l18)
                (i32.const 1)))
            (local.get $p6))))))
  (memory $memory 16 4096)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_resample_polyphase" (func $vm_resample_polyphase))
  (export "__heap_base" (global $__heap_base)))
