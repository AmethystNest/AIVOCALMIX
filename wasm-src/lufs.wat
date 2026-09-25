;; VM_LUFS_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 888 bytes; executable sections: 619 bytes.
(module $lufs.wasm
  (type $t0 (func (param i32 i32 i32 i32 i32 f64 f64 f64 f64 f64 f64 f64 f64 f64 f64 i32 i32 i32 i32)))
  (func $vm_kweight_accumulate (type $t0) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32) (param $p5 f64) (param $p6 f64) (param $p7 f64) (param $p8 f64) (param $p9 f64) (param $p10 f64) (param $p11 f64) (param $p12 f64) (param $p13 f64) (param $p14 f64) (param $p15 i32) (param $p16 i32) (param $p17 i32) (param $p18 i32)
    (local $l19 i32) (local $l20 f64) (local $l21 f64) (local $l22 f64) (local $l23 f64) (local $l24 f64) (local $l25 f64) (local $l26 f64) (local $l27 f64) (local $l28 f64) (local $l29 f64) (local $l30 i32) (local $l31 i32) (local $l32 f64)
    (local.set $l19
      (i32.lt_s
        (local.get $p1)
        (i32.const 1)))
    (local.set $l20
      (f64.load offset=64
        (local.get $p15)))
    (local.set $l21
      (f64.load offset=56
        (local.get $p15)))
    (local.set $l22
      (f64.load offset=48
        (local.get $p15)))
    (local.set $l23
      (f64.load offset=40
        (local.get $p15)))
    (local.set $l24
      (f64.load offset=32
        (local.get $p15)))
    (local.set $l25
      (f64.load offset=24
        (local.get $p15)))
    (local.set $l26
      (f64.load offset=16
        (local.get $p15)))
    (local.set $l27
      (f64.load offset=8
        (local.get $p15)))
    (local.set $l28
      (f64.load
        (local.get $p15)))
    (block $B0
      (block $B1
        (br_if $B1
          (i32.eqz
            (f64.lt
              (f64.abs
                (local.tee $l29
                  (f64.load offset=72
                    (local.get $p15))))
              (f64.const 0x1p+31 (;=2.14748e+09;)))))
        (local.set $l30
          (i32.trunc_f64_s
            (local.get $l29)))
        (br $B0))
      (local.set $l30
        (i32.const -2147483648)))
    (block $B2
      (block $B3
        (br_if $B3
          (i32.eqz
            (local.get $l19)))
        (local.set $p14
          (local.get $l24))
        (br $B2))
      (local.set $l31
        (i32.sub
          (i32.const 1)
          (local.get $p3)))
      (local.set $l32
        (f64.convert_i32_s
          (local.get $p3)))
      (local.set $l29
        (f64.neg
          (local.get $p14)))
      (local.set $p13
        (f64.neg
          (local.get $p13)))
      (local.set $p9
        (f64.neg
          (local.get $p9)))
      (local.set $p8
        (f64.neg
          (local.get $p8)))
      (local.set $p14
        (local.get $l26))
      (loop $L4
        (local.set $l26
          (local.get $l27))
        (local.set $l27
          (local.get $l28))
        (local.set $l24
          (f64.mul
            (local.tee $l22
              (f64.promote_f32
                (f32.demote_f64
                  (f64.add
                    (f64.mul
                      (local.get $l29)
                      (local.get $l21))
                    (f64.add
                      (f64.mul
                        (local.get $p13)
                        (local.tee $l21
                          (local.get $l22)))
                      (f64.add
                        (f64.mul
                          (local.get $p12)
                          (local.get $l23))
                        (f64.add
                          (f64.mul
                            (local.get $p10)
                            (local.tee $p14
                              (f64.promote_f32
                                (f32.demote_f64
                                  (f64.add
                                    (f64.mul
                                      (local.get $p9)
                                      (local.get $l25))
                                    (f64.add
                                      (f64.mul
                                        (local.get $p8)
                                        (local.tee $l25
                                          (local.get $p14)))
                                      (f64.add
                                        (f64.mul
                                          (local.get $p7)
                                          (local.get $l26))
                                        (f64.add
                                          (f64.mul
                                            (local.get $p5)
                                            (local.tee $l28
                                              (f64.promote_f32
                                                (f32.load
                                                  (local.get $p0)))))
                                          (f64.mul
                                            (local.get $l27)
                                            (local.get $p6))))))))))
                          (f64.mul
                            (local.tee $l23
                              (local.get $l24))
                            (local.get $p11)))))))))
            (local.get $l22)))
        (local.set $p2
          (i32.rem_s
            (local.tee $l19
              (local.get $p2))
            (local.get $p3)))
        (block $B5
          (br_if $B5
            (i32.lt_s
              (local.get $l19)
              (local.get $p3)))
          (local.set $l20
            (f64.sub
              (local.get $l20)
              (f64.load
                (i32.add
                  (local.get $p16)
                  (i32.shl
                    (local.get $p2)
                    (i32.const 3)))))))
        (f64.store
          (i32.add
            (local.get $p16)
            (i32.shl
              (local.get $p2)
              (i32.const 3)))
          (local.get $l24))
        (local.set $l20
          (f64.add
            (local.get $l24)
            (local.get $l20)))
        (block $B6
          (br_if $B6
            (i32.lt_s
              (local.tee $p2
                (i32.add
                  (local.get $l19)
                  (i32.const 1)))
              (local.get $p3)))
          (br_if $B6
            (i32.rem_s
              (i32.add
                (local.get $l31)
                (local.get $l19))
              (local.get $p4)))
          (br_if $B6
            (i32.ge_s
              (local.get $l30)
              (local.get $p18)))
          (f64.store
            (local.tee $l19
              (i32.add
                (local.get $p17)
                (i32.shl
                  (local.get $l30)
                  (i32.const 3))))
            (f64.add
              (f64.div
                (select
                  (f64.const 0x0p+0 (;=0;))
                  (local.get $l20)
                  (f64.lt
                    (local.get $l20)
                    (f64.const 0x0p+0 (;=0;))))
                (local.get $l32))
              (f64.load
                (local.get $l19))))
          (local.set $l30
            (i32.add
              (local.get $l30)
              (i32.const 1))))
        (local.set $p0
          (i32.add
            (local.get $p0)
            (i32.const 4)))
        (local.set $l26
          (local.get $p14))
        (local.set $l24
          (local.get $p14))
        (br_if $L4
          (local.tee $p1
            (i32.add
              (local.get $p1)
              (i32.const -1))))))
    (f64.store offset=64
      (local.get $p15)
      (local.get $l20))
    (f64.store offset=56
      (local.get $p15)
      (local.get $l21))
    (f64.store offset=48
      (local.get $p15)
      (local.get $l22))
    (f64.store offset=40
      (local.get $p15)
      (local.get $l23))
    (f64.store offset=32
      (local.get $p15)
      (local.get $p14))
    (f64.store offset=24
      (local.get $p15)
      (local.get $l25))
    (f64.store offset=16
      (local.get $p15)
      (local.get $l26))
    (f64.store offset=8
      (local.get $p15)
      (local.get $l27))
    (f64.store
      (local.get $p15)
      (local.get $l28))
    (f64.store offset=72
      (local.get $p15)
      (f64.convert_i32_s
        (local.get $l30))))
  (memory $memory 16 1024)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_kweight_accumulate" (func $vm_kweight_accumulate))
  (export "__heap_base" (global $__heap_base)))
