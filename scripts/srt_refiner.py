import os
import re
import argparse
from openai import OpenAI
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

def refine_srt(srt_path, txt_path, output_path, model="gpt-4o-mini"):
    """SRT 파일을 원본 텍스트와 비교하여 교정합니다."""
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY가 .env 파일에 설정되어 있지 않습니다.")
        return

    client = OpenAI(api_key=api_key)
    
    if not os.path.exists(srt_path):
        print(f"Error: SRT 파일을 찾을 수 없습니다: {srt_path}")
        return
    if not os.path.exists(txt_path):
        print(f"Error: 원본 텍스트 파일을 찾을 수 없습니다: {txt_path}")
        return
        
    with open(srt_path, 'r', encoding='utf-8') as f:
        srt_content = f.read()
        
    with open(txt_path, 'r', encoding='utf-8') as f:
        raw_text = f.read()
        
    # JSON 형식인 경우 summary 필드 추출 시도
    import json
    try:
        data = json.loads(raw_text)
        if isinstance(data, dict) and "summary" in data:
            original_text = data["summary"]
            print("Info: JSON 형식에서 'summary' 필드를 추출하여 사용합니다.")
        else:
            original_text = raw_text
    except json.JSONDecodeError:
        original_text = raw_text

    # SRT 블록 단위로 분리 (공백 라인 기준)
    blocks = re.split(r'\n\s*\n', srt_content.strip())
    
    refined_blocks = []
    chunk_size = 15 # 15개 블록씩 처리 (토큰 및 안정성 고려)
    
    total_blocks = len(blocks)
    print(f"총 {total_blocks}개의 자막 블록을 처리를 시작합니다. (모델: {model})")

    for i in range(0, total_blocks, chunk_size):
        chunk = "\n\n".join(blocks[i:i + chunk_size])
        
        # 문맥을 위해 원본 텍스트를 함께 전달
        # 텍스트가 너무 길 경우를 대비해 나중에 최적화가 필요할 수 있음
        prompt = f"""
원본 텍스트(정답 가이드):
\"\"\"
{original_text}
\"\"\"

교정할 SRT 자막 청크:
\"\"\"
{chunk}
\"\"\"

지시사항:
1. 제공된 '원본 텍스트'를 참고하여 SRT 자막의 오타, 잘못 인식된 단어, 띄어쓰기를 정확하게 수정하세요.
2. 타임스탬프(예: 00:00:10,000 --> 00:00:15,000)와 자막 번호는 **절대** 변경하거나 삭제하지 마세요. 형식을 엄격히 유지해야 합니다.
3. 자막의 줄 바꿈이나 구조는 가급적 유지하되, 내용의 정확도를 최우선으로 하세요.
4. 출력은 반드시 수정된 SRT 형식만 출력하세요. 다른 설명이나 인사말은 생략하세요.
"""

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "너는 전문 영상 자막 편집자야. 원본 텍스트를 바탕으로 STT로 생성된 자막의 오류를 완벽하게 교정하는 전문가야."},
                    {"role": "user", "content": prompt}
                ],
            )
            
            refined_text = response.choices[0].message.content.strip()
            # AI 응답에서 마크다운 코드 블록 제거
            refined_text = re.sub(r'```srt|```', '', refined_text).strip()
            refined_blocks.append(refined_text)
            
            current_progress = min(i + chunk_size, total_blocks)
            print(f"[{current_progress}/{total_blocks}] 처리 완료...")
            
        except Exception as e:
            print(f"Error 처리 중 오류 발생 (Index {i}): {e}")
            # 오류 발생 시 원본 청크라도 유지 (선택 사항)
            refined_blocks.append(chunk)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n\n".join(refined_blocks))
    
    print(f"\n[Success] 교정 완료! 결과가 다음 경로에 저장되었습니다: {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SRT 자막 교정 도구 (GPT-4o-mini 활용)")
    parser.add_argument("--srt", required=True, help="입력 SRT 파일 경로")
    parser.add_argument("--txt", required=True, help="원본 텍스트 파일 경로")
    parser.add_argument("--out", default="refined_output.srt", help="출력 SRT 파일 경로")
    parser.add_argument("--model", default="gpt-4o-mini", help="사용할 OpenAI 모델")
    
    args = parser.parse_args()
    
    refine_srt(args.srt, args.txt, args.out, args.model)
