;; VM_CLIPSTATS_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 761 bytes; executable sections: 490 bytes.
(module $clip.wasm
  (type $t0 (func (param i32 i32 f64 i32 i32 i32) (result i32)))
  (func $vm_clipstats_accumulate (type $t0) (param $p0 i32) (param $p1 i32) (param $p2 f64) (param $p3 i32) (param $p4 i32) (param $p5 i32) (result i32)
    (local $l6 f64) (local $l7 f64) (local $l8 i32) (local $l9 i32) (local $l10 i32) (local $l11 f32)
    (local.set $l6
      (f64.load offset=16
        (local.get $p5)))
    (block $B0
      (block $B1
        (br_if $B1
          (i32.eqz
            (f64.lt
              (f64.abs
                (local.tee $l7
                  (f64.load offset=8
                    (local.get $p5))))
              (f64.const 0x1p+31 (;=2.14748e+09;)))))
        (local.set $l8
          (i32.trunc_f64_s
            (local.get $l7)))
        (br $B0))
      (local.set $l8
        (i32.const -2147483648)))
    (local.set $l9
      (i32.lt_s
        (local.get $p1)
        (i32.const 1)))
    (block $B2
      (block $B3
        (br_if $B3
          (i32.eqz
            (f64.lt
              (f64.abs
                (local.tee $l7
                  (f64.load
                    (local.get $p5))))
              (f64.const 0x1p+31 (;=2.14748e+09;)))))
        (local.set $l10
          (i32.trunc_f64_s
            (local.get $l7)))
        (br $B2))
      (local.set $l10
        (i32.const -2147483648)))
    (block $B4
      (block $B5
        (br_if $B5
          (local.get $l9))
        (loop $L6
          (local.set $l9
            (i32.const 0))
          (br_if $B4
            (f64.lt
              (local.tee $l7
                (f64.promote_f32
                  (local.tee $l11
                    (f32.load
                      (local.get $p0)))))
              (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
          (br_if $B4
            (f32.ne
              (local.get $l11)
              (local.get $l11)))
          (br_if $B4
            (f64.gt
              (local.get $l7)
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (block $B7
            (block $B8
              (block $B9
                (br_if $B9
                  (i32.eqz
                    (f64.ge
                      (select
                        (f64.neg
                          (local.get $l7))
                        (local.get $l7)
                        (f32.lt
                          (local.get $l11)
                          (f32.const 0x0p+0 (;=0;))))
                      (local.get $p2))))
                (local.set $l9
                  (select
                    (i32.const 1)
                    (i32.const -1)
                    (f32.ge
                      (local.get $l11)
                      (f32.const 0x0p+0 (;=0;)))))
                (br_if $B8
                  (i32.eqz
                    (local.get $l10)))
                (block $B10
                  (br_if $B10
                    (i32.ne
                      (local.get $l9)
                      (local.get $l8)))
                  (local.set $l10
                    (i32.add
                      (local.get $l10)
                      (i32.const 1)))
                  (br $B7))
                (local.set $l6
                  (select
                    (local.get $l6)
                    (f64.add
                      (local.get $l6)
                      (f64.convert_i32_s
                        (local.get $l10)))
                    (i32.lt_s
                      (local.get $l10)
                      (local.get $p3))))
                (br $B8))
              (local.set $l6
                (select
                  (local.get $l6)
                  (f64.add
                    (local.get $l6)
                    (f64.convert_i32_s
                      (local.get $l10)))
                  (i32.lt_s
                    (local.get $l10)
                    (local.get $p3))))
              (local.set $l8
                (i32.const 0))
              (local.set $l10
                (i32.const 0))
              (br $B7))
            (local.set $l8
              (local.get $l9))
            (local.set $l10
              (i32.const 1)))
          (local.set $p0
            (i32.add
              (local.get $p0)
              (i32.const 4)))
          (br_if $L6
            (local.tee $p1
              (i32.add
                (local.get $p1)
                (i32.const -1))))))
      (f64.store offset=8
        (local.get $p5)
        (select
          (f64.const 0x0p+0 (;=0;))
          (f64.convert_i32_s
            (local.get $l8))
          (local.tee $p0
            (i32.and
              (i32.ne
                (local.get $p4)
                (i32.const 0))
              (i32.gt_s
                (local.get $l10)
                (i32.const 0))))))
      (f64.store
        (local.get $p5)
        (select
          (f64.const 0x0p+0 (;=0;))
          (f64.convert_i32_s
            (local.get $l10))
          (local.get $p0)))
      (f64.store offset=16
        (local.get $p5)
        (select
          (select
            (local.get $l6)
            (f64.add
              (local.get $l6)
              (f64.convert_i32_u
                (local.get $l10)))
            (i32.lt_s
              (local.get $l10)
              (local.get $p3)))
          (local.get $l6)
          (local.get $p0)))
      (local.set $l9
        (i32.const 1)))
    (local.get $l9))
  (memory $memory 16 1024)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_clipstats_accumulate" (func $vm_clipstats_accumulate))
  (export "__heap_base" (global $__heap_base)))
