;; VM_WASM_DSP_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 1320 bytes; executable sections: 964 bytes.
(module $dsp.wasm
  (type $t0 (func))
  (type $t1 (func (param i32)))
  (type $t2 (func (param i32 i32 f64 f64 f64 f64 f64 i32)))
  (type $t3 (func (param i32 i32 i32 i32 i32 f64 i32)))
  (type $t4 (func (param i32 i32 f64)))
  (func $__wasm_call_ctors (type $t0))
  (func $vm_biquad_reset (type $t1) (param $p0 i32)
    (i64.store
      (local.get $p0)
      (i64.const 0))
    (i64.store
      (i32.add
        (local.get $p0)
        (i32.const 24))
      (i64.const 0))
    (i64.store
      (i32.add
        (local.get $p0)
        (i32.const 16))
      (i64.const 0))
    (i64.store
      (i32.add
        (local.get $p0)
        (i32.const 8))
      (i64.const 0)))
  (func $vm_biquad_process (type $t2) (param $p0 i32) (param $p1 i32) (param $p2 f64) (param $p3 f64) (param $p4 f64) (param $p5 f64) (param $p6 f64) (param $p7 i32)
    (local $l8 f64) (local $l9 f64) (local $l10 f64) (local $l11 f64) (local $l12 f64) (local $l13 f64)
    (local.set $l8
      (f64.load offset=24
        (local.get $p7)))
    (local.set $l9
      (f64.load offset=16
        (local.get $p7)))
    (local.set $l10
      (f64.load offset=8
        (local.get $p7)))
    (local.set $l11
      (f64.load
        (local.get $p7)))
    (block $B0
      (block $B1
        (br_if $B1
          (i32.ge_s
            (local.get $p1)
            (i32.const 1)))
        (local.set $p5
          (local.get $l9))
        (local.set $p6
          (local.get $l10))
        (br $B0))
      (local.set $l12
        (f64.neg
          (local.get $p6)))
      (local.set $l13
        (f64.neg
          (local.get $p5)))
      (loop $L2
        (local.set $p6
          (local.get $l11))
        (f32.store
          (local.get $p0)
          (f32.demote_f64
            (local.tee $p5
              (f64.add
                (f64.mul
                  (local.get $l12)
                  (local.get $l8))
                (f64.add
                  (f64.mul
                    (local.get $l13)
                    (local.get $l9))
                  (f64.add
                    (f64.mul
                      (local.get $p4)
                      (local.get $l10))
                    (f64.add
                      (f64.mul
                        (local.get $p2)
                        (local.tee $l11
                          (f64.promote_f32
                            (f32.load
                              (local.get $p0)))))
                      (f64.mul
                        (local.get $p6)
                        (local.get $p3)))))))))
        (local.set $p0
          (i32.add
            (local.get $p0)
            (i32.const 4)))
        (local.set $l8
          (local.get $l9))
        (local.set $l10
          (local.get $p6))
        (local.set $l9
          (local.get $p5))
        (br_if $L2
          (local.tee $p1
            (i32.add
              (local.get $p1)
              (i32.const -1))))))
    (f64.store offset=24
      (local.get $p7)
      (local.get $l8))
    (f64.store offset=16
      (local.get $p7)
      (local.get $p5))
    (f64.store offset=8
      (local.get $p7)
      (local.get $p6))
    (f64.store
      (local.get $p7)
      (local.get $l11)))
  (func $vm_limiter_reset (type $t1) (param $p0 i32)
    (i64.store
      (local.get $p0)
      (i64.const 4607182418800017408)))
  (func $vm_limiter_process (type $t3) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32) (param $p5 f64) (param $p6 i32)
    (local $l7 f64) (local $l8 f64) (local $l9 i32) (local $l10 f64)
    (local.set $l7
      (f64.load
        (local.get $p6)))
    (block $B0
      (br_if $B0
        (i32.lt_s
          (local.get $p3)
          (i32.const 1)))
      (local.set $l8
        (f64.sub
          (f64.const 0x1p+0 (;=1;))
          (local.get $p5)))
      (local.set $l9
        (i32.const 0))
      (loop $L1
        (local.set $l7
          (select
            (local.tee $l10
              (f64.promote_f32
                (f32.load
                  (local.get $p1))))
            (f64.add
              (f64.mul
                (local.get $p5)
                (local.get $l7))
              (f64.mul
                (local.get $l8)
                (local.get $l10)))
            (f64.gt
              (local.get $l7)
              (local.get $l10))))
        (block $B2
          (br_if $B2
            (i32.ge_s
              (local.get $l9)
              (local.get $p4)))
          (f32.store
            (local.get $p2)
            (f32.demote_f64
              (f64.mul
                (local.get $l7)
                (f64.promote_f32
                  (f32.load
                    (local.get $p0)))))))
        (local.set $p0
          (i32.add
            (local.get $p0)
            (i32.const 4)))
        (local.set $p2
          (i32.add
            (local.get $p2)
            (i32.const 4)))
        (local.set $p1
          (i32.add
            (local.get $p1)
            (i32.const 4)))
        (br_if $L1
          (i32.ne
            (local.get $p3)
            (local.tee $l9
              (i32.add
                (local.get $l9)
                (i32.const 1)))))))
    (f64.store
      (local.get $p6)
      (local.get $l7)))
  (func $vm_gain_process (type $t4) (param $p0 i32) (param $p1 i32) (param $p2 f64)
    (local $l3 i32) (local $l4 i32) (local $l5 i32) (local $l6 i32)
    (block $B0
      (br_if $B0
        (i32.lt_s
          (local.get $p1)
          (i32.const 1)))
      (local.set $l3
        (i32.and
          (local.get $p1)
          (i32.const 3)))
      (local.set $l4
        (i32.const 0))
      (block $B1
        (br_if $B1
          (i32.lt_u
            (local.get $p1)
            (i32.const 4)))
        (local.set $l5
          (i32.and
            (local.get $p1)
            (i32.const 2147483644)))
        (local.set $l4
          (i32.const 0))
        (local.set $p1
          (local.get $p0))
        (loop $L2
          (f32.store
            (local.get $p1)
            (f32.demote_f64
              (f64.mul
                (f64.promote_f32
                  (f32.load
                    (local.get $p1)))
                (local.get $p2))))
          (f32.store
            (local.tee $l6
              (i32.add
                (local.get $p1)
                (i32.const 4)))
            (f32.demote_f64
              (f64.mul
                (f64.promote_f32
                  (f32.load
                    (local.get $l6)))
                (local.get $p2))))
          (f32.store
            (local.tee $l6
              (i32.add
                (local.get $p1)
                (i32.const 8)))
            (f32.demote_f64
              (f64.mul
                (f64.promote_f32
                  (f32.load
                    (local.get $l6)))
                (local.get $p2))))
          (f32.store
            (local.tee $l6
              (i32.add
                (local.get $p1)
                (i32.const 12)))
            (f32.demote_f64
              (f64.mul
                (f64.promote_f32
                  (f32.load
                    (local.get $l6)))
                (local.get $p2))))
          (local.set $p1
            (i32.add
              (local.get $p1)
              (i32.const 16)))
          (br_if $L2
            (i32.ne
              (local.get $l5)
              (local.tee $l4
                (i32.add
                  (local.get $l4)
                  (i32.const 4)))))))
      (br_if $B0
        (i32.eqz
          (local.get $l3)))
      (local.set $p1
        (i32.add
          (local.get $p0)
          (i32.shl
            (local.get $l4)
            (i32.const 2))))
      (loop $L3
        (f32.store
          (local.get $p1)
          (f32.demote_f64
            (f64.mul
              (f64.promote_f32
                (f32.load
                  (local.get $p1)))
              (local.get $p2))))
        (local.set $p1
          (i32.add
            (local.get $p1)
            (i32.const 4)))
        (br_if $L3
          (local.tee $l3
            (i32.add
              (local.get $l3)
              (i32.const -1)))))))
  (memory $memory 2)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__dso_handle i32 (i32.const 1024))
  (global $__data_end i32 (i32.const 1024))
  (global $__stack_low i32 (i32.const 1024))
  (global $__stack_high i32 (i32.const 66560))
  (global $__global_base i32 (i32.const 1024))
  (global $__heap_base i32 (i32.const 66560))
  (global $__heap_end i32 (i32.const 131072))
  (global $__memory_base i32 (i32.const 0))
  (global $__table_base i32 (i32.const 1))
  (export "memory" (memory $memory))
  (export "__wasm_call_ctors" (func $__wasm_call_ctors))
  (export "vm_biquad_reset" (func $vm_biquad_reset))
  (export "vm_biquad_process" (func $vm_biquad_process))
  (export "vm_limiter_reset" (func $vm_limiter_reset))
  (export "vm_limiter_process" (func $vm_limiter_process))
  (export "vm_gain_process" (func $vm_gain_process))
  (export "__dso_handle" (global $__dso_handle))
  (export "__data_end" (global $__data_end))
  (export "__stack_low" (global $__stack_low))
  (export "__stack_high" (global $__stack_high))
  (export "__global_base" (global $__global_base))
  (export "__heap_base" (global $__heap_base))
  (export "__heap_end" (global $__heap_end))
  (export "__memory_base" (global $__memory_base))
  (export "__table_base" (global $__table_base)))
